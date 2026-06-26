const pool = require("../../config/db")

const getOrders = async (req, res) => {
  try {
    const user_id = req.user.id

    // Only customer-relevant fields — vendor assignment details are NOT exposed
    const orders = await pool.query(
      `SELECT id, total_amount, payment_method, payment_status, delivery_slot, status,
              packed_photo, delivery_photo, created_at
       FROM orders WHERE user_id=$1 ORDER BY created_at DESC`,
      [user_id]
    )

    res.json(orders.rows)
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = getOrders
