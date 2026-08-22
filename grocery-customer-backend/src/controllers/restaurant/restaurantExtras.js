// ────────────────────────────────────────────────────────────────────────────
// restaurantExtras.js — Offers, Reviews and Reports for the partner panel.
//
// Every query is scoped to the restaurant the caller owns. One outlet must
// never be able to read or mutate another's data, so ownership is resolved
// once here and applied to every statement.
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../../config/db")

async function ownedRestaurant(userId) {
  const r = await pool.query(`SELECT id, commission_percent FROM food_restaurants WHERE owner_id=$1`, [userId])
  return r.rows[0] || null
}

/* ═══════════════════════════ OFFERS ═══════════════════════════ */

// GET /api/restaurant/offers
exports.getOffers = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `SELECT * FROM food_offers WHERE restaurant_id=$1 ORDER BY id DESC`, [rest.id])
    res.json({ success: true, offers: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/restaurant/offers
exports.createOffer = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })

    const b = req.body || {}
    const code = String(b.code || "").trim().toUpperCase()
    if (!code) return res.status(400).json({ message: "A coupon needs a code" })
    if (!/^[A-Z0-9]{3,20}$/.test(code))
      return res.status(400).json({ message: "Code should be 3-20 letters or numbers" })

    const type = b.discount_type === "flat" ? "flat" : "percent"
    const value = Number(b.discount_value)
    if (!Number.isFinite(value) || value <= 0)
      return res.status(400).json({ message: "Discount must be more than zero" })
    if (type === "percent" && value > 100)
      return res.status(400).json({ message: "A percentage cannot exceed 100" })

    const r = await pool.query(
      `INSERT INTO food_offers
         (restaurant_id, code, discount_type, discount_value, min_order, max_discount,
          valid_days, valid_hour_from, valid_hour_to, first_order_only, funded_by, usage_limit, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'restaurant',$11,true)
       RETURNING *`,
      [rest.id, code, type, value,
       Number(b.min_order) || 0,
       b.max_discount ? Number(b.max_discount) : null,
       b.valid_days || null,
       b.valid_hour_from || null,
       b.valid_hour_to || null,
       b.first_order_only === true || b.first_order_only === "true",
       b.usage_limit ? Number(b.usage_limit) : null])

    res.json({ success: true, offer: r.rows[0] })
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ message: "You already have a coupon with that code" })
    res.status(500).json({ message: e.message })
  }
}

// POST /api/restaurant/offers/:id/toggle
exports.toggleOffer = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `UPDATE food_offers SET is_active = NOT is_active
       WHERE id=$1 AND restaurant_id=$2 RETURNING *`, [req.params.id, rest.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Coupon not found" })
    res.json({ success: true, offer: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// DELETE /api/restaurant/offers/:id
exports.deleteOffer = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `DELETE FROM food_offers WHERE id=$1 AND restaurant_id=$2 RETURNING id`,
      [req.params.id, rest.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Coupon not found" })
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

/* ═══════════════════════════ REVIEWS ═══════════════════════════ */

// GET /api/restaurant/reviews
exports.getReviews = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })

    const r = await pool.query(
      `SELECT rv.id, rv.order_id, rv.rating, rv.comment, rv.complaint,
              rv.reply, rv.replied_at, rv.created_at,
              u.name AS customer_name
       FROM food_reviews rv
       LEFT JOIN users u ON u.id = rv.customer_id
       WHERE rv.restaurant_id=$1
       ORDER BY rv.id DESC LIMIT 100`, [rest.id])

    // rating breakdown, so the panel can show 5-star .. 1-star counts
    const b = await pool.query(
      `SELECT rating, COUNT(*)::int AS n FROM food_reviews
       WHERE restaurant_id=$1 AND rating IS NOT NULL
       GROUP BY rating ORDER BY rating DESC`, [rest.id])
    const breakdown = { 5:0, 4:0, 3:0, 2:0, 1:0 }
    b.rows.forEach(x => { breakdown[x.rating] = x.n })

    const total = b.rows.reduce((a, x) => a + x.n, 0)
    const avg = total
      ? b.rows.reduce((a, x) => a + x.rating * x.n, 0) / total
      : 0

    res.json({ success: true, reviews: r.rows, breakdown, total, average: Number(avg.toFixed(2)) })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/restaurant/reviews/:id/reply   { reply }
exports.replyReview = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })

    const reply = String((req.body || {}).reply || "").trim()
    if (!reply) return res.status(400).json({ message: "Write something first" })
    if (reply.length > 600) return res.status(400).json({ message: "Reply is too long" })

    const r = await pool.query(
      `UPDATE food_reviews SET reply=$1, replied_at=NOW()
       WHERE id=$2 AND restaurant_id=$3 RETURNING *`, [reply, req.params.id, rest.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Review not found" })
    res.json({ success: true, review: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

/* ═══════════════════════════ REPORTS ═══════════════════════════ */

// GET /api/restaurant/reports?days=7
exports.getReports = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90)

    // headline numbers over the window
    const s = await pool.query(
      `SELECT
         COUNT(*)::int                                                   AS orders_total,
         COUNT(*) FILTER (WHERE order_status='delivered')::int           AS delivered,
         COUNT(*) FILTER (WHERE order_status='cancelled')::int           AS cancelled,
         COALESCE(SUM(total_amount) FILTER (WHERE order_status='delivered'),0) AS gross,
         COALESCE(AVG(total_amount) FILTER (WHERE order_status='delivered'),0) AS aov,
         ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - accepted_at))/60)
               FILTER (WHERE ready_at IS NOT NULL AND accepted_at IS NOT NULL)::numeric, 1) AS avg_prep_min
       FROM food_orders
       WHERE restaurant_id=$1 AND created_at >= NOW() - ($2 || ' days')::interval`,
      [rest.id, String(days)])

    // rejection counts come from the audit trail, which is the honest source
    const rj = await pool.query(
      `SELECT COUNT(*)::int AS rejected
       FROM food_order_events e
       JOIN food_orders o ON o.id = e.order_id
       WHERE o.restaurant_id=$1 AND e.actor_type='restaurant'
         AND e.to_status='cancelled'
         AND e.created_at >= NOW() - ($2 || ' days')::interval`,
      [rest.id, String(days)])

    const byDay = await pool.query(
      `SELECT to_char(created_at::date,'DD Mon') AS label,
              created_at::date AS d,
              COUNT(*)::int AS orders,
              COALESCE(SUM(total_amount) FILTER (WHERE order_status='delivered'),0) AS sales
       FROM food_orders
       WHERE restaurant_id=$1 AND created_at >= NOW() - ($2 || ' days')::interval
       GROUP BY created_at::date ORDER BY created_at::date`,
      [rest.id, String(days)])

    const byHour = await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at)::int AS hour,
              COUNT(*)::int AS orders,
              COALESCE(SUM(total_amount) FILTER (WHERE order_status='delivered'),0) AS sales
       FROM food_orders
       WHERE restaurant_id=$1 AND created_at >= NOW() - ($2 || ' days')::interval
       GROUP BY 1 ORDER BY 1`,
      [rest.id, String(days)])

    // top dishes: order lines live in the items jsonb column
    const dishes = await pool.query(
      `SELECT it->>'name' AS name,
              SUM((it->>'quantity')::int)::int AS qty,
              SUM((it->>'line_total')::numeric) AS sales
       FROM food_orders o, jsonb_array_elements(o.items) AS it
       WHERE o.restaurant_id=$1
         AND o.order_status='delivered'
         AND o.created_at >= NOW() - ($2 || ' days')::interval
       GROUP BY it->>'name'
       ORDER BY qty DESC`,
      [rest.id, String(days)])

    const st = s.rows[0] || {}
    const total = Number(st.orders_total || 0)
    const rejected = Number(rj.rows[0]?.rejected || 0)

    res.json({
      success: true,
      days,
      summary: {
        orders_total: total,
        delivered: Number(st.delivered || 0),
        cancelled: Number(st.cancelled || 0),
        rejected,
        gross: Number(st.gross || 0),
        aov: Math.round(Number(st.aov || 0)),
        avg_prep_min: st.avg_prep_min == null ? null : Number(st.avg_prep_min),
        acceptance_rate: total ? Number((100 * (total - rejected) / total).toFixed(1)) : null,
        rejection_rate: total ? Number((100 * rejected / total).toFixed(1)) : null,
      },
      by_day: byDay.rows,
      by_hour: byHour.rows,
      top_dishes: dishes.rows.slice(0, 8),
      worst_dishes: dishes.rows.slice(-5).reverse(),
    })
  } catch (e) {
    console.log("getReports error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
