// Admin view of what is owed and what has been paid.
// Mounted under the admin routes; every handler assumes admin auth upstream.

const pool = require("../../config/db")
const { runCycle, settleRestaurant, markPaid } = require("../../services/settlementService")

// GET /api/admin/settlements?status=pending
exports.list = async (req, res) => {
  try {
    const status = req.query.status || "pending"
    const r = await pool.query(
      `SELECT s.*, fr.restaurant_name, fr.phone, fr.upi_id, fr.bank_account_details,
              (SELECT COUNT(*) FROM restaurant_payouts p WHERE p.settlement_id = s.id)::int AS order_count
       FROM food_settlements s
       JOIN food_restaurants fr ON fr.id = s.restaurant_id
       WHERE ($1 = 'all' OR s.status = $1)
       ORDER BY s.status = 'pending' DESC, s.id DESC
       LIMIT 200`, [status])

    const totals = await pool.query(
      `SELECT COALESCE(SUM(net_payable),0) AS due
       FROM food_settlements WHERE status = 'pending'`)

    res.json({ success: true, settlements: r.rows, total_due: Number(totals.rows[0].due) })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/admin/settlements/:id  — the order-wise breakdown behind one settlement
exports.detail = async (req, res) => {
  try {
    const s = await pool.query(
      `SELECT s.*, fr.restaurant_name, fr.upi_id
       FROM food_settlements s JOIN food_restaurants fr ON fr.id = s.restaurant_id
       WHERE s.id=$1`, [req.params.id])
    if (s.rows.length === 0) return res.status(404).json({ message: "Not found" })

    const lines = await pool.query(
      `SELECT p.*, o.created_at AS ordered_at, o.total_amount AS order_total
       FROM restaurant_payouts p
       LEFT JOIN food_orders o ON o.id = p.order_id
       WHERE p.settlement_id=$1 ORDER BY p.id`, [req.params.id])

    res.json({ success: true, settlement: s.rows[0], lines: lines.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/admin/settlements/unsettled — earnings not yet grouped into a cycle
exports.unsettled = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT fr.id AS restaurant_id, fr.restaurant_name, fr.upi_id,
              COUNT(p.id)::int AS orders,
              COALESCE(SUM(p.food_amount),0)      AS gross,
              COALESCE(SUM(p.commission_amount),0) AS commission,
              COALESCE(SUM(p.payout_amount),0)     AS net,
              MIN(p.created_at) AS since
       FROM restaurant_payouts p
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
       WHERE p.settlement_id IS NULL AND p.payout_status = 'pending'
       GROUP BY fr.id, fr.restaurant_name, fr.upi_id
       ORDER BY net DESC`)
    res.json({ success: true, restaurants: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/admin/settlements/run — close the cycle now, for everyone
exports.run = async (req, res) => {
  try {
    const n = await runCycle()
    res.json({ success: true, created: n })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/admin/settlements/run/:restaurantId — close it for one restaurant
exports.runOne = async (req, res) => {
  try {
    const s = await settleRestaurant(Number(req.params.restaurantId))
    if (!s) return res.status(400).json({ message: "Nothing to settle for that restaurant" })
    res.json({ success: true, settlement: s })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/admin/settlements/:id/paid   { reference }
// Records that money actually moved. Paid by UPI today; when RazorpayX is in
// place this is where the transfer call goes, and nothing else changes.
exports.markPaid = async (req, res) => {
  try {
    const ref = (req.body || {}).reference
    const s = await markPaid(Number(req.params.id), ref)
    if (!s) return res.status(409).json({ message: "Already paid, or not found" })
    res.json({ success: true, settlement: s })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
