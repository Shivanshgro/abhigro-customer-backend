const pool = require("../config/db")
const { emitDeliveryAvailable, emitOrderUpdate } = require("../socket/emit")

// Roles that count as a delivery boy. Kept permissive so it works regardless of
// the exact string admin assigned when creating delivery accounts.
const DELIVERY_ROLES = ["delivery", "delivery_boy", "deliveryboy", "rider", "delivery-boy"]

// Insert a single notification row (table: notifications(user_id,title,message,created_at))
async function notifyUser(userId, title, message) {
  if (!userId) return
  try {
    await pool.query(
      `INSERT INTO notifications(user_id, title, message) VALUES ($1,$2,$3)`,
      [userId, title, message]
    )
  } catch (e) { console.log("notifyUser error:", e.message) }
}

// Fan-out a notification to every delivery-boy account, and emit a live event.
// Used when a vendor marks an order Packed -> "ready for pickup".
async function notifyDeliveryBoys(order, title, message) {
  try {
    const boys = await pool.query(
      `SELECT id FROM users WHERE LOWER(role) = ANY($1::text[])`,
      [DELIVERY_ROLES]
    )
    for (const b of boys.rows) {
      await notifyUser(b.id, title, message)
    }
    emitDeliveryAvailable({
      orderId: order.id,
      pincode: order.pincode || null,
      total: order.total_amount || null,
      message,
    })
  } catch (e) { console.log("notifyDeliveryBoys error:", e.message) }
}

module.exports = { notifyUser, notifyDeliveryBoys, emitOrderUpdate, DELIVERY_ROLES }
