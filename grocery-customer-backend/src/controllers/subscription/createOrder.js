const Razorpay = require("razorpay")
const pool = require("../../config/db")

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
})

const createSubscriptionOrder = async (req, res) => {
  try {
    const user_id = req.user.id
    const existing = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id=$1 AND active=true AND end_date > NOW()`,
      [user_id]
    )
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "You already have an active subscription" })
    }
    const order = await razorpay.orders.create({
      amount: 24900,
      currency: "INR",
      receipt: `sub_${user_id}_${Date.now()}`,
      notes: { user_id, type: "subscription" }
    })
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

module.exports = createSubscriptionOrder