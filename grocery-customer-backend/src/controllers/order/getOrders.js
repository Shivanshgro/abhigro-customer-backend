const pool = require("../../config/db")

const getOrders = async (req, res) => {
  try {
    const user_id = req.user.id

    const orders = await pool.query(
      `SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC`,
      [user_id]
    )

    res.json(orders.rows)
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = getOrders
