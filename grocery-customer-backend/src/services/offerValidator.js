// ────────────────────────────────────────────────────────────────────────────
// offerValidator.js
//
// The single place a coupon is judged. Called from checkout AND from the
// customer's "apply coupon" button, so the preview and the charge can never
// disagree. The client never computes a discount; it only displays one.
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../config/db")

// Returns { ok, discount, offer, message }
async function validateOffer({ code, restaurantId, customerId, foodAmount }) {
  const raw = String(code || "").trim().toUpperCase()
  if (!raw) return { ok: true, discount: 0, offer: null }

  const r = await pool.query(
    `SELECT * FROM food_offers WHERE restaurant_id=$1 AND UPPER(code)=$2`,
    [restaurantId, raw])
  if (r.rows.length === 0)
    return { ok: false, discount: 0, offer: null, message: "That code is not valid for this restaurant" }

  const o = r.rows[0]
  if (!o.is_active)
    return { ok: false, discount: 0, offer: null, message: "This coupon is not running right now" }

  const now = new Date()
  if (o.valid_from && now < new Date(o.valid_from))
    return { ok: false, discount: 0, offer: null, message: "This coupon has not started yet" }
  if (o.valid_to && now > new Date(o.valid_to))
    return { ok: false, discount: 0, offer: null, message: "This coupon has expired" }

  // day of week, e.g. valid_days = 'Mon,Tue,Wed'
  if (o.valid_days) {
    const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
    const today = names[now.getDay()]
    const allowed = o.valid_days.split(",").map(x => x.trim().slice(0, 3))
    if (allowed.length && !allowed.includes(today))
      return { ok: false, discount: 0, offer: null, message: `This coupon runs on ${o.valid_days}` }
  }

  // hour window
  if (o.valid_hour_from && o.valid_hour_to) {
    const hhmm = now.toTimeString().slice(0, 5)
    const from = String(o.valid_hour_from).slice(0, 5)
    const to = String(o.valid_hour_to).slice(0, 5)
    const inWindow = from <= to
      ? (hhmm >= from && hhmm <= to)
      : (hhmm >= from || hhmm <= to)      // window crossing midnight
    if (!inWindow)
      return { ok: false, discount: 0, offer: null, message: `Valid between ${from} and ${to}` }
  }

  if (Number(o.min_order) > 0 && Number(foodAmount) < Number(o.min_order)) {
    const short = Math.ceil(Number(o.min_order) - Number(foodAmount))
    return { ok: false, discount: 0, offer: null, message: `Add ${short} more to use this coupon` }
  }

  if (o.usage_limit != null && Number(o.used_count) >= Number(o.usage_limit))
    return { ok: false, discount: 0, offer: null, message: "This coupon has been fully used" }

  if (o.first_order_only && customerId) {
    const prev = await pool.query(
      `SELECT 1 FROM food_orders
       WHERE customer_id=$1 AND order_status NOT IN ('cancelled','refunded')
       LIMIT 1`, [customerId])
    if (prev.rows.length > 0)
      return { ok: false, discount: 0, offer: null, message: "This coupon is for a first order only" }
  }

  let discount = o.discount_type === "percent"
    ? (Number(foodAmount) * Number(o.discount_value)) / 100
    : Number(o.discount_value)

  if (o.max_discount != null) discount = Math.min(discount, Number(o.max_discount))
  // never discount more than the food itself
  discount = Math.min(discount, Number(foodAmount))
  discount = Math.round(discount * 100) / 100

  return { ok: true, discount, offer: o }
}

// Called once the order is actually created.
async function markUsed(offerId) {
  if (!offerId) return
  try {
    await pool.query(`UPDATE food_offers SET used_count = COALESCE(used_count,0) + 1 WHERE id=$1`, [offerId])
  } catch (e) { console.log("markUsed error:", e.message) }
}

module.exports = { validateOffer, markUsed }
