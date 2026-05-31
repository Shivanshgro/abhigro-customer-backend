const crypto = require("crypto")
const pool = require("../../config/db")

const verifySubscriptionPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
    const user_id = req.user.id

    const body = razorpay_order_id + "|" + razorpay_payment_id
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body).digest("hex")

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: "Invalid payment signature" })
    }

    const startDate = new Date()
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + 30)

    await pool.query(
      `INSERT INTO subscriptions(user_id, start_date, end_date, active, payment_id, amount)
       VALUES($1,$2,$3,true,$4,249)`,
      [user_id, startDate, endDate, razorpay_payment_id]
    )

    res.json({ success: true, message: "Subscription activated for 30 days!" })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

module.exports = verifySubscriptionPayment