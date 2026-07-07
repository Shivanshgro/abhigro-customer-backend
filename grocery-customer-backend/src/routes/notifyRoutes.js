const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const pool = require("../config/db")

// GET /api/notify/my?as=vendor  -> latest 50 for me (typed rows for my user id + broadcast rows) + unread count
router.get("/my", auth, async (req, res) => {
  try {
    const as = String(req.query.as || "customer")
    const uid = req.user.id
    const r = await pool.query(
      `SELECT * FROM panel_notifications
       WHERE recipient_type=$1 AND (recipient_id=$2 OR recipient_id IS NULL)
       ORDER BY created_at DESC LIMIT 50`, [as, uid])
    const u = await pool.query(
      `SELECT COUNT(*) FROM panel_notifications
       WHERE recipient_type=$1 AND (recipient_id=$2 OR recipient_id IS NULL) AND is_read=false`, [as, uid])
    res.json({ success: true, notifications: r.rows, unread: parseInt(u.rows[0].count, 10) })
  } catch (e) { res.status(500).json({ message: e.message }) }
})

// PUT /api/notify/:id/read
router.put("/:id/read", auth, async (req, res) => {
  try {
    await pool.query(`UPDATE panel_notifications SET is_read=true WHERE id=$1`, [req.params.id])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
})

// PUT /api/notify/read-all?as=vendor
router.put("/read-all", auth, async (req, res) => {
  try {
    const as = String(req.query.as || "customer")
    await pool.query(
      `UPDATE panel_notifications SET is_read=true
       WHERE recipient_type=$1 AND (recipient_id=$2 OR recipient_id IS NULL)`, [as, req.user.id])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
})

module.exports = router
