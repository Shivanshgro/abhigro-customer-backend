const pool = require("../../config/db")

const trackOrder = async (req, res) => {
  try {
    const { id } = req.params

    const order = await pool.query(
      `SELECT id, status, payment_method, payment_status AS "paymentStatus",
              total_amount AS total, packed_photo AS "packedPhoto",
              delivery_photo AS "deliveryPhoto", created_at AS "createdAt"
       FROM orders WHERE id=$1`,
      [id]
    )

    if (order.rows.length === 0) {
      return res.status(404).json({ message: "Order Not Found" })
    }

    res.json(order.rows[0])
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = trackOrder
