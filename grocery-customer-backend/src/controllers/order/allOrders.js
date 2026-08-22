// ────────────────────────────────────────────────────────────────────────────
// allOrders.js — every order a customer has placed, in one list.
//
// AbhiGro keeps four order tables with four different column conventions:
//   orders                user_id     / status         / total_amount
//   food_orders           customer_id / order_status   / total_amount
//   medicine_orders       customer_id / order_status   / total_amount
//   assisted_food_orders  user_id     / status         / (no total)
// This normalises them into one shape so the customer sees a single history
// rather than having to remember which vertical they used.
//
// Each vertical is queried independently: if one throws, the rest still render.
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../../config/db")

// Rough state buckets, so one badge style works across four vocabularies.
const LIVE_GROCERY  = ["Pending", "Confirmed", "Processing", "Packed", "Out For Delivery"]
const LIVE_FOOD     = ["placed", "payment_successful", "restaurant_pending", "restaurant_accepted",
                       "preparing", "food_ready", "delivery_assigned", "delivery_arrived",
                       "picked_up", "out_for_delivery"]
const LIVE_MEDICINE = ["pending", "confirmed", "packed", "assigned_to_delivery_boy", "out_for_delivery"]
const DEAD          = ["cancelled", "Cancelled", "refunded", "Refunded"]

const bucket = (status, liveList) => {
  if (DEAD.includes(status)) return "cancelled"
  if (liveList.includes(status)) return "live"
  return "done"
}

// GET /api/orders/all
exports.allOrders = async (req, res) => {
  const me = req.user.id
  const out = []

  // ---- grocery ----
  try {
    const r = await pool.query(
      `SELECT o.id, o.status, o.total_amount, o.payment_status, o.payment_method, o.created_at,
              s.shop_name
       FROM orders o
       LEFT JOIN shops s ON s.id = o.assigned_shop_id
       WHERE o.user_id = $1
       ORDER BY o.id DESC LIMIT 50`, [me])
    for (const x of r.rows) {
      out.push({
        type: "grocery", label: "Grocery", id: x.id,
        title: x.shop_name || "AbhiGro store",
        status: x.status, state: bucket(x.status, LIVE_GROCERY),
        total: Number(x.total_amount || 0),
        payment_status: x.payment_status, payment_method: x.payment_method,
        created_at: x.created_at,
        track_url: x.status === "Out For Delivery" ? `/order-tracking/${x.id}` : `/orders/${x.id}`,
      })
    }
  } catch (e) { console.log("allOrders grocery:", e.message) }

  // ---- food ----
  try {
    const r = await pool.query(
      `SELECT o.id, o.order_status, o.total_amount, o.payment_status, o.created_at, o.items,
              fr.restaurant_name
       FROM food_orders o
       LEFT JOIN food_restaurants fr ON fr.id = o.restaurant_id
       WHERE o.customer_id = $1
       ORDER BY o.id DESC LIMIT 50`, [me])
    for (const x of r.rows) {
      const items = Array.isArray(x.items) ? x.items : []
      out.push({
        type: "food", label: "Food", id: x.id,
        title: x.restaurant_name || "Restaurant",
        subtitle: items.map(i => `${i.name} x${i.quantity}`).join(", "),
        status: x.order_status, state: bucket(x.order_status, LIVE_FOOD),
        total: Number(x.total_amount || 0),
        payment_status: x.payment_status,
        created_at: x.created_at,
        track_url: `/food/track/${x.id}`,
      })
    }
  } catch (e) { console.log("allOrders food:", e.message) }

  // ---- medicine ----
  try {
    const r = await pool.query(
      `SELECT o.id, o.order_number, o.order_status, o.total_amount, o.payment_status,
              o.payment_method, o.created_at, ph.pharmacy_name
       FROM medicine_orders o
       LEFT JOIN pharmacies ph ON ph.id = o.pharmacy_id
       WHERE o.customer_id = $1
       ORDER BY o.id DESC LIMIT 50`, [me])
    for (const x of r.rows) {
      out.push({
        type: "medicine", label: "Medicine", id: x.id,
        title: x.pharmacy_name || "Pharmacy",
        subtitle: x.order_number ? `Order ${x.order_number}` : null,
        status: x.order_status, state: bucket(x.order_status, LIVE_MEDICINE),
        total: Number(x.total_amount || 0),
        payment_status: x.payment_status, payment_method: x.payment_method,
        created_at: x.created_at,
        track_url: `/medicine/orders`,
      })
    }
  } catch (e) { console.log("allOrders medicine:", e.message) }

  // ---- assisted pickup ---- (no total on this table)
  try {
    const r = await pool.query(
      `SELECT id, status, created_at FROM assisted_food_orders
       WHERE user_id = $1 ORDER BY id DESC LIMIT 50`, [me])
    for (const x of r.rows) {
      out.push({
        type: "pickup", label: "Pickup", id: x.id,
        title: "Assisted pickup",
        status: x.status, state: bucket(x.status, LIVE_GROCERY),
        total: null,
        created_at: x.created_at,
        track_url: `/assisted-food/my`,
      })
    }
  } catch (e) { console.log("allOrders pickup:", e.message) }

  // newest first, live ones lifted to the top
  out.sort((a, b) => {
    if ((a.state === "live") !== (b.state === "live")) return a.state === "live" ? -1 : 1
    return new Date(b.created_at) - new Date(a.created_at)
  })

  res.json({ success: true, orders: out })
}
