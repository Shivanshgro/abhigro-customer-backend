// Read-only earnings endpoints for the partner app.
// Nothing here writes to orders or touches the delivery flow.
const pool = require("../../config/db")

// GET /api/partner/earnings/summary
// Today / yesterday / this week / lifetime + today's order count.
exports.summary = async (req, res) => {
  try {
    const pid = req.user.id
    const q = await pool.query(
      `SELECT
         COALESCE(SUM(total_pay) FILTER (WHERE earned_at::date = CURRENT_DATE),0)            AS today,
         COUNT(*)                FILTER (WHERE earned_at::date = CURRENT_DATE
                                          AND order_id IS NOT NULL)                          AS today_orders,
         COALESCE(SUM(total_pay) FILTER (WHERE earned_at::date = CURRENT_DATE - 1),0)        AS yesterday,
         COALESCE(SUM(total_pay) FILTER (WHERE earned_at >= date_trunc('week', CURRENT_DATE)),0) AS this_week,
         COALESCE(SUM(total_pay),0)                                                          AS lifetime,
         COALESCE(SUM(total_pay) FILTER (WHERE payout_id IS NULL),0)                         AS unpaid
       FROM partner_earnings WHERE partner_id=$1`, [pid])

    const r = q.rows[0] || {}
    res.json({
      success: true,
      today:        Number(r.today || 0),
      today_orders: Number(r.today_orders || 0),
      yesterday:    Number(r.yesterday || 0),
      this_week:    Number(r.this_week || 0),
      lifetime:     Number(r.lifetime || 0),
      unpaid:       Number(r.unpaid || 0),
    })
  } catch (e) {
    console.log("earnings summary error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// GET /api/partner/earnings/daily?days=14
exports.daily = async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14))
    const q = await pool.query(
      `SELECT earned_at::date AS day,
              COUNT(*) FILTER (WHERE order_id IS NOT NULL) AS orders,
              COALESCE(SUM(total_pay),0) AS total
       FROM partner_earnings
       WHERE partner_id=$1 AND earned_at >= CURRENT_DATE - $2::int
       GROUP BY 1 ORDER BY 1 DESC`, [req.user.id, days])
    res.json({ success: true, days: q.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/partner/earnings/orders?limit=50
// Order-wise earnings, joined to the REAL orders table (read-only).
exports.orderWise = async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const q = await pool.query(
      `SELECT pe.id, pe.order_id, pe.vertical,
              pe.base_pay, pe.distance_km, pe.distance_pay,
              pe.surge_pay, pe.surge_reason, pe.incentive_pay, pe.bonus_pay,
              pe.total_pay, pe.earned_at,
              o.status, o.delivered_at, o.payment_method,
              s.shop_name, a.city AS customer_area
       FROM partner_earnings pe
       LEFT JOIN orders o    ON o.id = pe.order_id
       LEFT JOIN shops s     ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       WHERE pe.partner_id=$1
       ORDER BY pe.earned_at DESC LIMIT $2`, [req.user.id, limit])
    res.json({ success: true, earnings: q.rows })
  } catch (e) {
    console.log("orderWise error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// GET /api/partner/earnings/order/:orderId — single breakdown
exports.breakdown = async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT * FROM partner_earnings WHERE order_id=$1 AND partner_id=$2`,
      [req.params.orderId, req.user.id])
    if (q.rows.length === 0)
      return res.status(404).json({ message: "No earning recorded for this order" })
    res.json({ success: true, earning: q.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/partner/payouts
exports.payouts = async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT * FROM partner_payouts WHERE partner_id=$1
       ORDER BY created_at DESC LIMIT 50`, [req.user.id])
    res.json({ success: true, payouts: q.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/partner/incentives — active incentives with this partner's progress
exports.incentives = async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT i.id, i.name, i.description, i.target_orders, i.extra_amount,
              i.window_start, i.window_end, i.conditions,
              COALESCE(p.completed,0) AS completed,
              p.achieved_at,
              GREATEST(0, i.target_orders - COALESCE(p.completed,0)) AS remaining
       FROM partner_incentives i
       LEFT JOIN partner_incentive_progress p
              ON p.incentive_id = i.id AND p.partner_id = $1
       WHERE i.is_active = true
         AND (i.window_end IS NULL OR i.window_end >= NOW())
       ORDER BY i.window_end NULLS LAST, i.id`, [req.user.id])
    res.json({ success: true, incentives: q.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/partner/rate-cards — active + upcoming
exports.rateCards = async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, name, kind, city, vertical, config,
              active_from, active_to, is_active,
              CASE WHEN active_from IS NOT NULL AND active_from > NOW()
                   THEN 'upcoming' ELSE 'active' END AS state
       FROM partner_rate_cards
       WHERE is_active = true
         AND (active_to IS NULL OR active_to >= NOW())
       ORDER BY state, kind, id`)
    res.json({ success: true, rate_cards: q.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/partner/online  { online: true|false }
exports.setOnline = async (req, res) => {
  try {
    const online = req.body?.online === true || req.body?.online === "true"
    await pool.query(
      `UPDATE delivery_partners SET is_online=$1,
         last_online_at = CASE WHEN $1 THEN NOW() ELSE last_online_at END
       WHERE user_id=$2`, [online, req.user.id])
    res.json({ success: true, online })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
