const pool = require("../../config/db")

const createOrderPayment = async (req, res) => {
  try {
    const user_id = req.user.id
    const { addressId, deliverySlot, delivery_slot, coupon } = req.body
    const slot = deliverySlot || delivery_slot || null

    // Get cart items from flat cart table
    const cart = await pool.query(
      `SELECT cart.id, cart.quantity, cart.product_id,
              products.price, products.name
       FROM cart
       JOIN products ON cart.product_id = products.id
       WHERE cart.user_id = $1`,
      [user_id]
    )

    if (cart.rows.length === 0) {
      return res.status(400).json({ message: "Cart is empty" })
    }

    // Check subscription
    const sub = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id=$1 AND active=true AND end_date > NOW() ORDER BY id DESC LIMIT 1`,
      [user_id]
    )
    const isSubscribed = sub.rows.length > 0

    // Calculate total
    const subtotal = cart.rows.reduce((acc, item) => acc + Number(item.price) * Number(item.quantity), 0)
    const deliveryCharge = isSubscribed ? 0 : (subtotal >= 299 ? 0 : 49)

    // Apply coupon
    let discount = 0
    if (coupon) {
      try {
        const couponRes = await pool.query(
          `SELECT * FROM coupons WHERE code=$1 AND active=true`,
          [coupon]
        )
        if (couponRes.rows.length > 0) {
          discount = Number(couponRes.rows[0].discount_amount) || 0
        }
      } catch (e) { console.log("Coupon error:", e.message) }
    }

    const total = Math.max(0, subtotal + deliveryCharge - discount)

    // Create pending order
    const order = await pool.query(
      `INSERT INTO orders(user_id, address_id, total_amount, status, payment_method, delivery_slot)
       VALUES($1,$2,$3,'Pending','Razorpay',$4) RETURNING id`,
      [user_id, addressId, total, slot]
    )
    const orderId = order.rows[0].id

    // Create Razorpay order
    const Razorpay = require("razorpay")
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    })

    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(total * 100),
      currency: "INR",
      receipt: `order_${orderId}_${Date.now()}`,
    })

    res.json({
      orderId,
      razorpayOrderId: rzpOrder.id,
      amount: total,
      isSubscribed
    })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = createOrderPayment