const Razorpay = require("razorpay")
const pool = require("../../config/db")

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
})

const placeDailyOrder = async (req, res) => {
  try {
    const user_id = req.user.id

    const sub = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id=$1 AND active=true AND end_date > NOW() ORDER BY id DESC LIMIT 1`,
      [user_id]
    )
    if (sub.rows.length === 0) return res.status(403).json({ message: "No active subscription" })

    if (new Date().getHours() >= 22) {
      return res.status(400).json({ message: "10 PM deadline passed. Try tomorrow!" })
    }

    const today = new Date(); today.setHours(0,0,0,0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    const existing = await pool.query(
      `SELECT id FROM orders WHERE user_id=$1 AND subscription_id=$2 AND created_at >= $3 AND created_at < $4`,
      [user_id, sub.rows[0].id, today, tomorrow]
    )
    if (existing.rows.length > 0) return res.status(400).json({ message: "Today's order already placed" })

    const products = await pool.query(
      `SELECT id, name, price FROM products 
       WHERE LOWER(name) IN ('milk', 'curd', 'eggs', 'bread') AND stock > 0 LIMIT 4`
    )
    if (products.rows.length === 0) return res.status(400).json({ message: "Products not available" })

    const address = await pool.query(
      `SELECT id FROM addresses WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [user_id]
    )
    if (address.rows.length === 0) return res.status(400).json({ message: "Please add a delivery address first" })

    const total = products.rows.reduce((acc, p) => acc + Number(p.price), 0)

    const order = await pool.query(
      `INSERT INTO orders(user_id, address_id, total_amount, status, payment_method, subscription_id)
       VALUES($1,$2,$3,'Pending','Razorpay',$4) RETURNING id`,
      [user_id, address.rows[0].id, total, sub.rows[0].id]
    )

    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(total * 100),
      currency: "INR",
      receipt: `daily_${user_id}_${Date.now()}`,
    })

    res.json({ orderId: order.rows[0].id, amount: total, razorpayOrderId: rzpOrder.id, products: products.rows })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

module.exports = placeDailyOrder