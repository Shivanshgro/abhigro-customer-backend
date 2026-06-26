const pool = require("../../config/db")

const createOrderPayment = async (req, res) => {
  try {
    const user_id = req.user.id
    const { addressId, address_id, deliverySlot, delivery_slot, coupon } = req.body
    const addr_id = addressId || address_id
    const slot = deliverySlot || delivery_slot || null

    const cart = await pool.query(
      `SELECT cart.id, cart.quantity, cart.product_id, products.price, products.name
       FROM cart JOIN products ON cart.product_id = products.id
       WHERE cart.user_id = $1`,
      [user_id]
    )
    if (cart.rows.length === 0) {
      return res.status(400).json({ message: "Cart is empty" })
    }

    const sub = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id=$1 AND active=true AND end_date > NOW() ORDER BY id DESC LIMIT 1`,
      [user_id]
    )
    const isSubscribed = sub.rows.length > 0
    const subtotal = cart.rows.reduce((acc, item) => acc + Number(item.price) * Number(item.quantity), 0)
    const deliveryCharge = isSubscribed ? 0 : (subtotal >= 299 ? 0 : 49)

    let discount = 0
    if (coupon) {
      try {
        const couponRes = await pool.query(`SELECT * FROM coupons WHERE code=$1 AND active=true`, [coupon])
        if (couponRes.rows.length > 0) discount = Number(couponRes.rows[0].discount_amount) || 0
      } catch (e) { console.log("Coupon error:", e.message) }
    }
    const total = Math.max(0, subtotal + deliveryCharge - discount)

    // Capture pincode (fallback to user latest address)
    let pincode = null
    let finalAddrId = addr_id
    try {
      let addr
      if (finalAddrId) addr = await pool.query(`SELECT id, pincode FROM addresses WHERE id=$1`, [finalAddrId])
      if (!addr || addr.rows.length === 0) addr = await pool.query(`SELECT id, pincode FROM addresses WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [user_id])
      if (addr.rows.length > 0) { finalAddrId = addr.rows[0].id; pincode = addr.rows[0].pincode || null }
    } catch (e) { console.log("pincode lookup error:", e.message) }

    const order = await pool.query(
      `INSERT INTO orders(user_id, address_id, total_amount, status, payment_method, delivery_slot, pincode, assignment_status, payment_status)
       VALUES($1,$2,$3,'Pending','Razorpay',$4,$5,'pending','Pending') RETURNING id`,
      [user_id, finalAddrId, total, slot, pincode]
    )
    const orderId = order.rows[0].id

    // Save order items for stock matching
    for (const it of cart.rows) {
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1,$2,$3,$4)`,
        [orderId, it.product_id, it.quantity, it.price])
    }

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

    res.json({ orderId, razorpayOrderId: rzpOrder.id, amount: total, isSubscribed })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = createOrderPayment
