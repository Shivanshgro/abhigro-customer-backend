const pool = require("../../config/db")

const getTodayOrder = async (req, res) => {
  try {
    const user_id = req.user.id
    const sub = await pool.query(
      `SELECT id FROM subscriptions WHERE user_id=$1 AND active=true AND end_date > NOW() ORDER BY id DESC LIMIT 1`,
      [user_id]
    )
    if (sub.rows.length === 0) return res.json(null)

    const today = new Date(); today.setHours(0,0,0,0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)

    const order = await pool.query(
      `SELECT id, status, total_amount FROM orders 
       WHERE user_id=$1 AND subscription_id=$2 AND created_at >= $3 AND created_at < $4
       ORDER BY id DESC LIMIT 1`,
      [user_id, sub.rows[0].id, today, tomorrow]
    )
    res.json(order.rows[0] || null)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

module.exports = getTodayOrder