const pool = require("../../config/db")

const getNotifications = async (req, res) => {
  try {
    const user_id = req.user.id

    const result = await pool.query(
      `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC`,
      [user_id]
    )

    res.json(result.rows)
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = getNotifications
