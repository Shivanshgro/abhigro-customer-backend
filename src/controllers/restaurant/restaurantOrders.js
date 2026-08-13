const pool = require("../../config/db")
const { transition } = require("../../services/foodOrderState")

// Resolve the restaurant this user owns. Kept exactly as before.
// NOTE: when restaurant_staff / multi-outlet lands, this is the single place to
// widen — every handler below already routes its ownership check through it.
async function ownedRestaurant(userId) {
  const r = await pool.query(`SELECT id FROM food_restaurants WHERE owner_id=$1`, [userId])
  return r.rows[0] || null
}

// Shared wrapper: resolve the restaurant, run the transition, map errors.
// Every status change now goes through foodOrderState.transition(), which:
//   - locks the row (two taps cannot both succeed)
//   - refuses illegal moves and orders belonging to another restaurant
//   - writes food_order_events in the SAME transaction as the status change
//   - emits to the customer and the restaurant room AFTER the commit
async function move(req, res, to, extra = {}) {
  const rest = await ownedRestaurant(req.user.id)
  if (!rest) return res.status(403).json({ message: "No restaurant" })
  try {
    const order = await transition({
      orderId: req.params.id,
      to,
      actorType: "restaurant",
      actorId: req.user.id,
      scope: { restaurantId: rest.id },
      ...extra,
    })
    return res.json({ success: true, order })
  } catch (e) {
    // TransitionError carries a real status code; anything else is a 500.
    return res.status(e.code || 500).json({ message: e.message })
  }
}

// GET /api/restaurant/orders — today's / active food orders for this restaurant
exports.getOrders = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `SELECT o.*, u.name AS customer_name, u.phone AS customer_phone
       FROM food_orders o LEFT JOIN users u ON u.id=o.customer_id
       WHERE o.restaurant_id=$1 ORDER BY o.id DESC LIMIT 100`, [rest.id])
    res.json({ success: true, orders: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/restaurant/orders/:id/accept   { prep_minutes }
// prep_minutes is new: the panel offers 10/15/20 and the countdown needs it.
exports.accept = async (req, res) => {
  const raw = parseInt(req.body.prep_minutes, 10)
  const prep = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 90) : 20
  return move(req, res, "restaurant_accepted", {
    set: { restaurant_accept_status: "accepted", prep_minutes: prep },
    note: `Accepted, ${prep} min`,
  })
}

// POST /api/restaurant/orders/:id/reject   { reason }
// Previously this had NO state guard and would cancel an already-delivered
// order. transition() now refuses anything past 'preparing'.
exports.reject = async (req, res) => {
  const reason = (req.body.reason || "Restaurant rejected").toString().slice(0, 300)
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const order = await transition({
      orderId: req.params.id,
      to: "cancelled",
      actorType: "restaurant",
      actorId: req.user.id,
      scope: { restaurantId: rest.id },
      set: {
        restaurant_accept_status: "rejected",
        cancellation_reason: reason,
        // only flag a refund if money was actually taken
        refund_status: "pending",
      },
      note: reason,
    })
    res.json({
      success: true,
      order,
      note: order.payment_status === "paid"
        ? "Customer refund flagged pending"
        : "No payment taken — nothing to refund",
    })
  } catch (e) {
    res.status(e.code || 500).json({ message: e.message })
  }
}

// POST /api/restaurant/orders/:id/preparing
exports.preparing = (req, res) => move(req, res, "preparing")

// POST /api/restaurant/orders/:id/ready — food ready; offered to delivery partners
// The emitDeliveryAvailable broadcast now happens inside transition(), so it
// fires only after the status change has actually committed.
exports.ready = (req, res) => move(req, res, "food_ready")

// GET /api/restaurant/payouts
exports.payouts = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `SELECT * FROM restaurant_payouts WHERE restaurant_id=$1 ORDER BY id DESC`, [rest.id])
    res.json({ success: true, payouts: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
