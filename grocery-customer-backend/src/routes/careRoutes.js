const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const pool = require("../config/db")

// ---- SUPPORT TICKETS (incl. refund & cancel requests) ----
// POST /api/care/tickets { order_type, order_id, issue_type, message }
router.post("/tickets", auth, async (req, res) => {
  try {
    const { order_type = "grocery", order_id = null, issue_type, message = "" } = req.body
    if (!issue_type) return res.status(400).json({ message: "issue_type required" })
    const r = await pool.query(
      `INSERT INTO support_tickets (user_id, order_type, order_id, issue_type, message)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, order_type, order_id, issue_type, message])
    try {
      require("../services/notify")({ to: "admin", type: "support",
        title: `Support: ${issue_type.replace(/_/g, " ")}${order_id ? " (order #" + order_id + ")" : ""}`,
        message: message.slice(0, 140), data: { ticket_id: r.rows[0].id } })
    } catch (e) {}
    res.json({ success: true, ticket: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
})
// GET /api/care/tickets/my
router.get("/tickets/my", auth, async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM support_tickets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.user.id])
    res.json({ success: true, tickets: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
})

// ---- RATINGS ----
// POST /api/care/ratings { order_type, order_id, stars, target, feedback }
router.post("/ratings", auth, async (req, res) => {
  try {
    const { order_type = "grocery", order_id, stars, target = "order", feedback = "" } = req.body
    if (!order_id || !stars) return res.status(400).json({ message: "order_id and stars required" })
    const r = await pool.query(
      `INSERT INTO order_ratings (user_id, order_type, order_id, stars, target, feedback)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, order_type, order_id, target)
       DO UPDATE SET stars=EXCLUDED.stars, feedback=EXCLUDED.feedback RETURNING *`,
      [req.user.id, order_type, order_id, Math.min(5, Math.max(1, parseInt(stars, 10))), target, feedback])
    res.json({ success: true, rating: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
})

// ---- WALLET ----
// GET /api/care/wallet -> balance + last 20 transactions
router.get("/wallet", auth, async (req, res) => {
  try {
    const b = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END),0) AS balance
       FROM wallet_transactions WHERE user_id=$1`, [req.user.id])
    const t = await pool.query(
      `SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.user.id])
    res.json({ success: true, balance: Number(b.rows[0].balance), transactions: t.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
})
module.exports = router
