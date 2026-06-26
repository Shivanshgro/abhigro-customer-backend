const crypto = require("crypto")
const pool = require("../../config/db")
const { autoAssignOrder } = require("../vendor/autoAssignService")

const verifyOrderPayment = async (req, res) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
    const user_id = req.user.id

    const body = razorpay_order_id + "|" + razorpay_payment_id
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex")

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" })
    }

    // Confirm order + mark paid
    await pool.query(
      `UPDATE orders SET status='Confirmed', payment_status='Paid' WHERE id=$1 AND user_id=$2`,
      [orderId, user_id]
    )

    // Clear cart
    await pool.query(`DELETE FROM cart WHERE user_id=$1`, [user_id])

    // Auto-assign to nearest vendor (same pincode first, then zone)
    try {
      const ord = await pool.query(`SELECT pincode FROM orders WHERE id=$1`, [orderId])
      const items = await pool.query(`SELECT product_id, quantity FROM order_items WHERE order_id=$1`, [orderId])
      const pincode = ord.rows[0]?.pincode || null
      await autoAssignOrder(orderId, pincode, items.rows)
    } catch (e) {
      console.log("Auto-assign error (payment):", e.message)
    }

    res.json({ success: true, message: "Order confirmed!" })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = verifyOrderPayment
