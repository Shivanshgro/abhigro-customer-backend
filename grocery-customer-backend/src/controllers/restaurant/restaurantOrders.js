const pool = require("../../config/db")
const { emitOrderUpdate, emitDeliveryAvailable } = require("../../socket/emit")

async function ownedRestaurant(userId) {
  const r = await pool.query(`SELECT id FROM food_restaurants WHERE owner_id=$1`, [userId])
  return r.rows[0] || null
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

// POST /api/restaurant/orders/:id/accept
exports.accept = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `UPDATE food_orders SET restaurant_accept_status='accepted', order_status='restaurant_accepted', accepted_at=NOW()
       WHERE id=$1 AND restaurant_id=$2 AND order_status IN ('payment_successful','restaurant_pending') RETURNING *`,
      [req.params.id, rest.id])
    if (r.rows.length === 0) return res.status(409).json({ message: "Order can't be accepted" })
    emitOrderUpdate(`food_${r.rows[0].id}`, { type: "status", order_status: "restaurant_accepted" })
    res.json({ success: true, order: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/restaurant/orders/:id/reject  { reason }
exports.reject = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `UPDATE food_orders SET restaurant_accept_status='rejected', order_status='cancelled',
         cancellation_reason=$1, refund_status='pending'
       WHERE id=$2 AND restaurant_id=$3 RETURNING *`,
      [req.body.reason || "Restaurant rejected", req.params.id, rest.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    emitOrderUpdate(`food_${r.rows[0].id}`, { type: "status", order_status: "cancelled" })
    res.json({ success: true, order: r.rows[0], note: "Customer refund flagged pending" })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/restaurant/orders/:id/preparing
exports.preparing = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `UPDATE food_orders SET order_status='preparing'
       WHERE id=$1 AND restaurant_id=$2 AND order_status='restaurant_accepted' RETURNING *`,
      [req.params.id, rest.id])
    if (r.rows.length === 0) return res.status(409).json({ message: "Can't mark preparing" })
    emitOrderUpdate(`food_${r.rows[0].id}`, { type: "status", order_status: "preparing" })
    res.json({ success: true, order: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/restaurant/orders/:id/ready  — food ready; offer to delivery partners
exports.ready = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `UPDATE food_orders SET order_status='food_ready'
       WHERE id=$1 AND restaurant_id=$2 AND order_status IN ('preparing','delivery_assigned') RETURNING *`,
      [req.params.id, rest.id])
    if (r.rows.length === 0) return res.status(409).json({ message: "Can't mark ready" })
    emitOrderUpdate(`food_${r.rows[0].id}`, { type: "status", order_status: "food_ready" })
    emitDeliveryAvailable({ type: "food", order_id: r.rows[0].id, restaurant_id: rest.id })
    res.json({ success: true, order: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/restaurant/payouts
exports.payouts = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(`SELECT * FROM restaurant_payouts WHERE restaurant_id=$1 ORDER BY id DESC`, [rest.id])
    res.json({ success: true, payouts: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
