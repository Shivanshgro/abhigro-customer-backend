// ────────────────────────────────────────────────────────────────────────────
// foodTracking.js — what the customer sees while they wait.
//
// The timeline is read from food_order_events, not inferred from the current
// status. That matters: the events table is the only thing that knows an order
// was rejected by the kitchen rather than cancelled by the customer, and it
// carries real timestamps for each step rather than guesses.
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../../config/db")

// The journey a customer is shown. Internal states map onto these; anything
// not listed (delivery_assigned, delivery_arrived) is deliberately hidden -
// a customer does not need to know the rider is standing in the kitchen.
const STEPS = [
  { k: "placed",       t: "Order placed",     s: "We have sent it to the kitchen",
    when: ["placed", "payment_successful", "restaurant_pending"] },
  { k: "accepted",     t: "Kitchen accepted", s: "Your food is being prepared",
    when: ["restaurant_accepted", "preparing"] },
  { k: "ready",        t: "Ready",            s: "Packed and waiting for a rider",
    when: ["food_ready", "delivery_assigned", "delivery_arrived"] },
  { k: "picked_up",    t: "Picked up",        s: "On the way to you",
    when: ["picked_up", "out_for_delivery"] },
  { k: "delivered",    t: "Delivered",        s: "Enjoy your food",
    when: ["delivered"] },
]

function etaMinutes(order) {
  if (order.order_status === "delivered") return 0
  const prep = Number(order.prep_minutes) || 20
  const ride = 15                                  // rough door-to-door
  const placed = new Date(order.accepted_at || order.created_at)
  const done = new Date(placed.getTime() + (prep + ride) * 60000)
  return Math.max(1, Math.round((done - Date.now()) / 60000))
}

// GET /api/food/order/:id/track
exports.track = async (req, res) => {
  try {
    const o = await pool.query(
      `SELECT o.*, fr.restaurant_name, fr.address AS restaurant_address, fr.phone AS restaurant_phone,
              u.name AS partner_name, u.phone AS partner_phone
       FROM food_orders o
       JOIN food_restaurants fr ON fr.id = o.restaurant_id
       LEFT JOIN users u ON u.id = o.delivery_partner_id
       WHERE o.id = $1 AND o.customer_id = $2`,
      [req.params.id, req.user.id])
    if (o.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const order = o.rows[0]

    const ev = await pool.query(
      `SELECT from_status, to_status, actor_type, note, created_at
       FROM food_order_events WHERE order_id = $1 ORDER BY id`, [req.params.id])

    // stamp each step with the moment it actually happened
    const reached = {}
    for (const e of ev.rows) {
      const step = STEPS.find(s => s.when.includes(e.to_status))
      if (step && !reached[step.k]) reached[step.k] = e.created_at
    }
    // an order created before the events table existed still shows as placed
    if (!reached.placed) reached.placed = order.created_at

    const cancelled = ["cancelled", "refunded"].includes(order.order_status)
    const rejectedByKitchen = ev.rows.some(
      e => e.to_status === "cancelled" && e.actor_type === "restaurant")

    const currentIdx = STEPS.findIndex(s => s.when.includes(order.order_status))

    const timeline = STEPS.map((s, i) => ({
      key: s.k,
      title: s.t,
      subtitle: s.k === "picked_up" && order.partner_name
        ? `${order.partner_name} is on the way`
        : s.s,
      done: !!reached[s.k],
      current: i === currentIdx && !cancelled,
      at: reached[s.k] || null,
    }))

    res.json({
      success: true,
      order: {
        id: order.id,
        status: order.order_status,
        cancelled,
        cancel_reason: order.cancellation_reason,
        rejected_by_kitchen: rejectedByKitchen,
        refund_status: order.refund_status,
        restaurant_name: order.restaurant_name,
        restaurant_phone: order.restaurant_phone,
        items: order.items || [],
        food_amount: Number(order.food_amount || 0),
        tax_amount: Number(order.tax_amount || 0),
        delivery_fee: Number(order.delivery_fee || 0),
        platform_fee: Number(order.platform_fee || 0),
        discount_amount: Number(order.discount_amount || 0),
        offer_code: order.offer_code,
        total_amount: Number(order.total_amount || 0),
        payment_status: order.payment_status,
        payment_method: order.payment_method,
        delivery_address: order.delivery_address,
        prep_minutes: order.prep_minutes,
        partner_name: order.partner_name,
        partner_phone: order.partner_phone,
        created_at: order.created_at,
        delivered_at: order.delivered_at,
      },
      eta_minutes: cancelled ? null : etaMinutes(order),
      timeline,
    })
  } catch (e) {
    console.log("track error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// POST /api/food/order/:id/cancel   { reason }
// A customer may cancel until the kitchen starts cooking. After that the food
// is already being made, so the answer is no - and saying so plainly is better
// than a button that silently fails.
exports.cancel = async (req, res) => {
  try {
    const { transition } = require("../../services/foodOrderState")
    const order = await transition({
      orderId: req.params.id,
      to: "cancelled",
      actorType: "customer",
      actorId: req.user.id,
      scope: { customerId: req.user.id },
      set: {
        cancellation_reason: (req.body || {}).reason || "Cancelled by customer",
        refund_status: "pending",
      },
      note: "Cancelled by customer",
    })
    res.json({
      success: true,
      order,
      message: order.payment_status === "paid"
        ? "Cancelled. Your refund has been raised."
        : "Cancelled. Nothing was charged.",
    })
  } catch (e) {
    res.status(e.code || 500).json({ message: e.message })
  }
}
