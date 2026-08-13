const pool = require("../../config/db")
const { transition } = require("../../services/foodOrderState")

// ── Restaurant payout ───────────────────────────────────────────────────────
// Recorded on successful delivery: food amount minus AbhiGro's commission.
// Note this is separate from platform_fee, which is charged to the customer.
async function recordPayout(order) {
  try {
    const rest = await pool.query(
      `SELECT commission_percent FROM food_restaurants WHERE id=$1`, [order.restaurant_id])
    const pct = Number(rest.rows[0]?.commission_percent ?? 10)
    const commission = Math.round(Number(order.food_amount) * (pct / 100) * 100) / 100
    const payout = Math.round((Number(order.food_amount) - commission) * 100) / 100
    // ON CONFLICT needs a unique index on order_id to actually protect anything —
    // see the note in the accompanying message. Harmless until then.
    await pool.query(
      `INSERT INTO restaurant_payouts(restaurant_id, order_id, food_amount, commission_amount, payout_amount, payout_status)
       VALUES($1,$2,$3,$4,$5,'pending')
       ON CONFLICT DO NOTHING`,
      [order.restaurant_id, order.id, order.food_amount, commission, payout])
  } catch (e) { console.log("recordPayout error:", e.message) }
}

// Shared wrapper — every rider status change goes through the state machine,
// which locks the row, refuses illegal moves, refuses another rider's order,
// writes the audit row in the same transaction, and emits after the commit.
async function move(req, res, to, extra = {}) {
  try {
    const order = await transition({
      orderId: req.params.id,
      to,
      actorType: "rider",
      actorId: req.user.id,
      scope: { riderId: req.user.id },
      ...extra,
    })
    return res.json({ success: true, order })
  } catch (e) {
    return res.status(e.code || 500).json({ message: e.message })
  }
}

// GET /api/food/delivery/available — food orders a rider can still claim.
// Includes orders not yet ready so a rider can start heading to the kitchen.
exports.available = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, fr.restaurant_name, fr.address AS restaurant_address,
              fr.latitude AS rest_lat, fr.longitude AS rest_lng
       FROM food_orders o JOIN food_restaurants fr ON fr.id=o.restaurant_id
       WHERE o.order_status IN ('food_ready','preparing','restaurant_accepted')
         AND o.delivery_partner_id IS NULL
       ORDER BY o.id DESC`)
    res.json({ success: true, orders: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/food/delivery/mine — this rider's active runs
exports.myDeliveries = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, fr.restaurant_name, fr.address AS restaurant_address,
              fr.latitude AS rest_lat, fr.longitude AS rest_lng,
              u.name AS customer_name
       FROM food_orders o
       JOIN food_restaurants fr ON fr.id=o.restaurant_id
       LEFT JOIN users u ON u.id=o.customer_id
       WHERE o.delivery_partner_id=$1
         AND o.order_status NOT IN ('delivered','cancelled','refunded')
       ORDER BY o.id DESC`, [req.user.id])
    res.json({ success: true, orders: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/food/delivery/:id/claim — NEW.
// Nothing previously set delivery_partner_id, so no rider could ever take a
// food order. Claim is first-come: the WHERE guard makes it atomic, so two
// riders tapping together cannot both win.
exports.claim = async (req, res) => {
  try {
    const claimed = await pool.query(
      `UPDATE food_orders SET delivery_partner_id=$1, updated_at=NOW()
       WHERE id=$2 AND delivery_partner_id IS NULL
         AND order_status IN ('restaurant_accepted','preparing','food_ready')
       RETURNING *`, [req.user.id, req.params.id])
    if (claimed.rows.length === 0)
      return res.status(409).json({ message: "Already taken by another partner" })

    // Only announce assignment once the food is actually ready; before that the
    // rider is simply en route and the order keeps its kitchen status.
    if (claimed.rows[0].order_status === "food_ready") {
      const order = await transition({
        orderId: req.params.id, to: "delivery_assigned",
        actorType: "rider", actorId: req.user.id,
        scope: { riderId: req.user.id }, note: "Rider claimed the order",
      })
      return res.json({ success: true, order })
    }
    res.json({ success: true, order: claimed.rows[0], note: "Claimed — waiting for the kitchen" })
  } catch (e) { res.status(e.code || 500).json({ message: e.message }) }
}

// POST /api/food/delivery/:id/arrived — NEW. Rider is at the restaurant.
exports.arrived = (req, res) => move(req, res, "delivery_arrived", { note: "Rider at restaurant" })

// POST /api/food/delivery/:id/pickup — NEW.
// Nothing wrote picked_up before, so out_for_delivery was unreachable.
exports.pickup = (req, res) => move(req, res, "picked_up", { note: "Collected from restaurant" })

// POST /api/food/delivery/:id/out
exports.outForDelivery = (req, res) => move(req, res, "out_for_delivery")

// POST /api/food/delivery/:id/delivered  { proof_image?, cash_collected? }
exports.delivered = async (req, res) => {
  try {
    const set = {}
    if (req.body.proof_image) set.delivery_photo = req.body.proof_image

    const order = await transition({
      orderId: req.params.id, to: "delivered",
      actorType: "rider", actorId: req.user.id,
      scope: { riderId: req.user.id }, set,
    })

    // Cash on delivery: record that the money was actually collected.
    if (order.payment_status !== "paid") {
      await pool.query(
        `UPDATE food_orders SET payment_status='collected' WHERE id=$1`, [order.id])
      order.payment_status = "collected"
    }

    await recordPayout(order)
    res.json({ success: true, order })
  } catch (e) { res.status(e.code || 500).json({ message: e.message }) }
}

// POST /api/food/order/:id/rate  { rating, comment, complaint }  (customer)
exports.rate = async (req, res) => {
  try {
    const { rating, comment, complaint } = req.body
    const n = parseInt(rating, 10)
    if (!Number.isFinite(n) || n < 1 || n > 5)
      return res.status(400).json({ message: "Rating must be 1 to 5" })

    // Only a delivered order can be rated, and only once.
    const o = await pool.query(
      `SELECT restaurant_id, order_status FROM food_orders WHERE id=$1 AND customer_id=$2`,
      [req.params.id, req.user.id])
    if (o.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    if (o.rows[0].order_status !== "delivered")
      return res.status(409).json({ message: "You can rate once the order is delivered" })

    const dup = await pool.query(
      `SELECT id FROM food_reviews WHERE order_id=$1 AND item_id IS NULL`, [req.params.id])
    if (dup.rows.length > 0) return res.status(409).json({ message: "You have already rated this order" })

    await pool.query(
      `INSERT INTO food_reviews(order_id, restaurant_id, customer_id, rating, comment, complaint)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [req.params.id, o.rows[0].restaurant_id, req.user.id, n, comment || null, complaint || null])

    await pool.query(
      `UPDATE food_restaurants
          SET rating = (SELECT COALESCE(AVG(rating),0) FROM food_reviews
                         WHERE restaurant_id=$1 AND rating IS NOT NULL),
              rating_count = (SELECT COUNT(*) FROM food_reviews
                               WHERE restaurant_id=$1 AND rating IS NOT NULL)
        WHERE id=$1`, [o.rows[0].restaurant_id])

    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
