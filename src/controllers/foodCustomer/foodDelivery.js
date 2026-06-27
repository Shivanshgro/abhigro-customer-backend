const pool = require("../../config/db")
const { emitOrderUpdate } = require("../../socket/emit")

// Helper: compute + record restaurant payout (food amount minus commission)
async function recordPayout(order) {
  try {
    const rest = await pool.query(`SELECT commission_percent FROM food_restaurants WHERE id=$1`, [order.restaurant_id])
    const pct = Number(rest.rows[0]?.commission_percent ?? 10)
    const commission = Math.round(Number(order.food_amount) * (pct/100) * 100) / 100
    const payout = Math.round((Number(order.food_amount) - commission) * 100) / 100
    await pool.query(
      `INSERT INTO restaurant_payouts(restaurant_id, order_id, food_amount, commission_amount, payout_amount, payout_status)
       VALUES($1,$2,$3,$4,$5,'pending')
       ON CONFLICT DO NOTHING`,
      [order.restaurant_id, order.id, order.food_amount, commission, payout])
  } catch (e) { console.log("recordPayout error:", e.message) }
}

// GET /api/food/delivery/available — food orders ready for pickup, unassigned
exports.available = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, fr.restaurant_name, fr.address AS restaurant_address, fr.latitude AS rest_lat, fr.longitude AS rest_lng
       FROM food_orders o JOIN food_restaurants fr ON fr.id=o.restaurant_id
       WHERE o.order_status IN ('food_ready','preparing','restaurant_accepted')
         AND o.delivery_partner_id IS NULL
       ORDER BY o.id DESC`)
    res.json({ success:true, orders:r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/food/delivery/:id/accept — partner takes the pickup
exports.acceptPickup = async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE food_orders SET delivery_partner_id=$1, order_status='delivery_assigned'
       WHERE id=$2 AND delivery_partner_id IS NULL RETURNING *`, [req.user.id, req.params.id])
    if (r.rows.length === 0) return res.status(409).json({ message: "Already taken" })
    emitOrderUpdate(`food_${r.rows[0].id}`, { type:"status", order_status:"delivery_assigned" })
    res.json({ success:true, order:r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

function gate(curr, allowed) { return allowed.includes(curr) }

// POST /api/food/delivery/:id/going
exports.goingToRestaurant = async (req, res) => {
  try {
    const o = await pool.query(`SELECT * FROM food_orders WHERE id=$1 AND delivery_partner_id=$2`, [req.params.id, req.user.id])
    if (o.rows.length === 0) return res.status(404).json({ message: "Not your order" })
    const r = await pool.query(`UPDATE food_orders SET order_status='partner_going' WHERE id=$1 RETURNING *`, [req.params.id])
    emitOrderUpdate(`food_${req.params.id}`, { type:"status", order_status:"partner_going" })
    res.json({ success:true, order:r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/food/delivery/:id/picked-up   (GATE: food must be ready)
exports.pickedUp = async (req, res) => {
  try {
    const o = await pool.query(`SELECT * FROM food_orders WHERE id=$1 AND delivery_partner_id=$2`, [req.params.id, req.user.id])
    if (o.rows.length === 0) return res.status(404).json({ message: "Not your order" })
    if (!gate(o.rows[0].order_status, ['food_ready','partner_going','delivery_assigned']))
      return res.status(409).json({ message: "Food not ready to pick up yet" })
    const r = await pool.query(`UPDATE food_orders SET order_status='picked_up' WHERE id=$1 RETURNING *`, [req.params.id])
    emitOrderUpdate(`food_${req.params.id}`, { type:"status", order_status:"picked_up" })
    res.json({ success:true, order:r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/food/delivery/:id/out
exports.outForDelivery = async (req, res) => {
  try {
    const o = await pool.query(`SELECT * FROM food_orders WHERE id=$1 AND delivery_partner_id=$2`, [req.params.id, req.user.id])
    if (o.rows.length === 0) return res.status(404).json({ message: "Not your order" })
    if (o.rows[0].order_status !== 'picked_up') return res.status(409).json({ message: "Pick up first" })
    const r = await pool.query(`UPDATE food_orders SET order_status='out_for_delivery' WHERE id=$1 RETURNING *`, [req.params.id])
    emitOrderUpdate(`food_${req.params.id}`, { type:"status", order_status:"out_for_delivery" })
    res.json({ success:true, order:r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/food/delivery/:id/delivered  { proof_image? }
exports.delivered = async (req, res) => {
  try {
    const o = await pool.query(`SELECT * FROM food_orders WHERE id=$1 AND delivery_partner_id=$2`, [req.params.id, req.user.id])
    if (o.rows.length === 0) return res.status(404).json({ message: "Not your order" })
    if (o.rows[0].order_status !== 'out_for_delivery') return res.status(409).json({ message: "Not out for delivery" })
    const r = await pool.query(`UPDATE food_orders SET order_status='delivered' WHERE id=$1 RETURNING *`, [req.params.id])
    // record restaurant payout on successful delivery
    await recordPayout(r.rows[0])
    emitOrderUpdate(`food_${req.params.id}`, { type:"status", order_status:"delivered" })
    res.json({ success:true, order:r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/food/order/:id/rate  { rating, comment, complaint }  (customer)
exports.rate = async (req, res) => {
  try {
    const { rating, comment, complaint } = req.body
    const o = await pool.query(`SELECT restaurant_id FROM food_orders WHERE id=$1 AND customer_id=$2`, [req.params.id, req.user.id])
    if (o.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    await pool.query(
      `INSERT INTO food_reviews(order_id, restaurant_id, customer_id, rating, comment, complaint)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [req.params.id, o.rows[0].restaurant_id, req.user.id, rating?parseInt(rating,10):null, comment||null, complaint||null])
    // refresh restaurant avg rating
    await pool.query(
      `UPDATE food_restaurants SET rating = (SELECT COALESCE(AVG(rating),0) FROM food_reviews WHERE restaurant_id=$1 AND rating IS NOT NULL)
       WHERE id=$1`, [o.rows[0].restaurant_id])
    res.json({ success:true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
