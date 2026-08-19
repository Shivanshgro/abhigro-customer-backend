// ────────────────────────────────────────────────────────────────────────────
// groceryTracking.js — what a customer sees while a grocery order is on its way.
//
// Grocery has no order_events table, so the timeline is built from the status
// plus the timestamp columns that do exist (created_at, picked_up_at,
// delivered_at, cancelled_at). Less precise than the food audit trail, but
// honest about what it knows.
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../../config/db")

// Internal statuses mapped onto the five things a customer cares about.
const STEPS = [
  { k: "confirmed", t: "Order confirmed",  s: "We have sent it to the store",
    when: ["Pending", "Confirmed", "Processing"] },
  { k: "packing",   t: "Being packed",     s: "The store is picking your items",
    when: ["Processing", "Packed"] },
  { k: "picked_up", t: "Picked up",        s: "Your rider has collected it",
    when: ["Out For Delivery"] },
  { k: "on_way",    t: "On the way",       s: "Arriving with you shortly",
    when: ["Out For Delivery"] },
  { k: "delivered", t: "Delivered",        s: "Order complete",
    when: ["Delivered", "Completed"] },
]

const DEAD = ["Cancelled", "Refunded"]

// GET /api/orders/:id/track
exports.track = async (req, res) => {
  try {
    const o = await pool.query(
      `SELECT o.*,
              s.shop_name, s.address AS shop_address, s.phone AS shop_phone,
              a.address_line, a.city, a.pincode AS drop_pincode,
              u.name AS rider_name, u.phone AS rider_phone
       FROM orders o
       LEFT JOIN shops s     ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN users u     ON u.id = o.delivery_boy_id
       WHERE o.id = $1 AND o.user_id = $2`,
      [req.params.id, req.user.id])
    if (o.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const order = o.rows[0]

    const items = await pool.query(
      `SELECT oi.quantity, oi.price, oi.cancelled,
              p.name, p.unit, p.image
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.id`, [req.params.id])

    const cancelled = DEAD.includes(order.status)
    const st = order.status

    // Which steps are behind us. Grocery status is a single value, so this is
    // inferred rather than recorded - the timestamps we do have are used where
    // they exist so the customer sees real times, not invented ones.
    const reachedIdx = {
      "Pending": 0, "Confirmed": 0, "Processing": 1, "Packed": 1,
      "Out For Delivery": 3, "Delivered": 4, "Completed": 4,
    }[st]
    const currentIdx = reachedIdx == null ? 0 : reachedIdx

    const stamps = {
      confirmed: order.created_at,
      picked_up: order.picked_up_at,
      on_way: order.picked_up_at,
      delivered: order.delivered_at,
    }

    const timeline = STEPS.map((s, i) => ({
      key: s.k,
      title: s.t,
      subtitle: s.k === "picked_up" && order.rider_name
        ? `${order.rider_name} collected your order`
        : s.k === "packing" && order.shop_name
          ? `${order.shop_name} is packing`
          : s.s,
      done: i <= currentIdx && !cancelled,
      current: i === currentIdx && !cancelled && !["Delivered", "Completed"].includes(st),
      at: stamps[s.k] || null,
    }))

    // ETA: slot if one was chosen, otherwise the estimate, otherwise a default
    let eta = null
    if (!cancelled && !["Delivered", "Completed"].includes(st)) {
      eta = Number(order.estimated_delivery_time) || 45
      if (order.picked_up_at) {
        const since = Math.round((Date.now() - new Date(order.picked_up_at)) / 60000)
        eta = Math.max(1, 20 - since)
      }
    }

    const itemTotal = items.rows
      .filter(i => !i.cancelled)
      .reduce((a, i) => a + Number(i.price) * Number(i.quantity), 0)

    res.json({
      success: true,
      order: {
        id: order.id,
        status: st,
        cancelled,
        cancel_reason: order.cancel_reason,
        assignment_status: order.assignment_status,
        shop_name: order.shop_name,
        shop_address: order.shop_address,
        shop_phone: order.shop_phone,
        rider_name: order.rider_name,
        rider_phone: order.rider_phone,
        packed_photo: order.packed_photo,
        delivery_photo: order.delivery_photo,
        item_total: Math.round(itemTotal * 100) / 100,
        delivery_fee: Number(order.delivery_fee || 0),
        platform_fee: Number(order.platform_fee || 0),
        total_amount: Number(order.total_amount || 0),
        payment_method: order.payment_method,
        payment_status: order.payment_status,
        cash_collected: order.cash_collected,
        delivery_slot: order.delivery_slot,
        delivery_instructions: order.delivery_instructions,
        drop_address: [order.address_line, order.city].filter(Boolean).join(", "),
        drop_pincode: order.drop_pincode,
        created_at: order.created_at,
        picked_up_at: order.picked_up_at,
        delivered_at: order.delivered_at,
      },
      items: items.rows.map(i => ({
        name: i.name || "Item",
        unit: i.unit,
        image: i.image,
        quantity: i.quantity,
        price: Number(i.price),
        line_total: Math.round(Number(i.price) * Number(i.quantity) * 100) / 100,
        cancelled: i.cancelled,
      })),
      eta_minutes: eta,
      timeline,
    })
  } catch (e) {
    console.log("grocery track error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
