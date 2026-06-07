const crypto = require("crypto")
const pool = require("../../config/db")

const verifyOrderPayment = async (req, res) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
    const user_id = req.user.id

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex")

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" })
    }

    // Confirm order
    await pool.query(
      `UPDATE orders SET status='Confirmed' WHERE id=$1 AND user_id=$2`,
      [orderId, user_id]
    )

    // Clear cart
    await pool.query(`DELETE FROM cart WHERE user_id=$1`, [user_id])

    res.json({ success: true, message: "Order confirmed!" })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = verifyOrderPayment