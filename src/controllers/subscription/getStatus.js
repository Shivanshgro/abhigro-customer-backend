const pool = require("../../config/db")

const getSubscriptionStatus = async (req, res) => {
  try {
    const user_id = req.user.id
    const sub = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id=$1 AND active=true AND end_date > NOW() ORDER BY id DESC LIMIT 1`,
      [user_id]
    )
    if (sub.rows.length === 0) return res.json({ active: false })
    res.json({ active: true, ...sub.rows[0] })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

module.exports = getSubscriptionStatus