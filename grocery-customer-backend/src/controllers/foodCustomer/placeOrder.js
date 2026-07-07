const pool = require("../../config/db")
const crypto = require("crypto")

let razorpay = null
try {
  const Razorpay = require("razorpay")
  const KEY = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY
  const SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET
  if (KEY && SECRET) razorpay = new Razorpay({ key_id: KEY, key_secret: SECRET })
} catch (e) {}

async function settings() {
  const d = { food_platform_fee:10, food_delivery_fee:30, food_tax_percent:5 }
  try { const r = await pool.query(`SELECT key,value FROM app_settings WHERE key LIKE 'food_%'`)
    for (const row of r.rows) { const n=Number(row.value); if(!isNaN(n)) d[row.key]=n } } catch(e){}
  return d
}

// POST /api/food/order  { restaurant_id, items:[{item_id,quantity}], delivery_address, delivery_lat, delivery_lng, delivery_phone }
// Validates items against the restaurant's live menu + availability + online status.
exports.placeOrder = async (req, res) => {
  try {
    const customerId = req.user.id
    const { restaurant_id, items, delivery_address, delivery_lat, delivery_lng, delivery_phone } = req.body
    if (!restaurant_id || !Array.isArray(items) || items.length === 0)
      return res.status(400).json({ message: "Restaurant and items required" })

    const rest = await pool.query(`SELECT id, is_online, is_approved FROM food_restaurants WHERE id=$1`, [restaurant_id])
    if (rest.rows.length === 0 || !rest.rows[0].is_approved) return res.status(404).json({ message: "Restaurant unavailable" })
    if (!rest.rows[0].is_online) return res.status(409).json({ message: "Restaurant is currently offline" })

    // price items server-side from the DB (never trust client prices)
    let foodAmount = 0
    const lineItems = []
    for (const it of items) {
      const p = await pool.query(`SELECT id,name,price,is_available FROM food_items WHERE id=$1 AND restaurant_id=$2 AND is_active=true`, [it.item_id, restaurant_id])
      if (p.rows.length === 0) return res.status(400).json({ message: `Item ${it.item_id} not found` })
      if (!p.rows[0].is_available) return res.status(409).json({ message: `${p.rows[0].name} is unavailable` })
      const qty = Math.max(1, parseInt(it.quantity,10) || 1)
      const line = Number(p.rows[0].price) * qty
      foodAmount += line
      lineItems.push({ item_id: p.rows[0].id, name: p.rows[0].name, price: Number(p.rows[0].price), quantity: qty, line_total: line })
    }

    const s = await settings()
    const platformFee = s.food_platform_fee
    const deliveryFee = s.food_delivery_fee
    const tax = Math.round(foodAmount * (s.food_tax_percent/100) * 100) / 100
    const total = Math.round((foodAmount + platformFee + deliveryFee + tax) * 100) / 100

    const o = await pool.query(
      `INSERT INTO food_orders
        (customer_id, restaurant_id, items, food_amount, platform_fee, delivery_fee, tax_amount, total_amount,
         payment_status, order_status, delivery_address, delivery_latitude, delivery_longitude, delivery_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending','placed',$9,$10,$11,$12) RETURNING *`,
      [customerId, restaurant_id, JSON.stringify(lineItems), foodAmount, platformFee, deliveryFee, tax, total,
       delivery_address||null, delivery_lat||null, delivery_lng||null, delivery_phone||null])
    const order = o.rows[0]

    // create Razorpay order for the full total
    if (razorpay) {
      const rzp = await razorpay.orders.create({ amount: Math.round(total*100), currency:"INR", receipt:`food_${order.id}` })
      await pool.query(`UPDATE food_orders SET razorpay_order_id=$1 WHERE id=$2`, [rzp.id, order.id])
      return res.json({ success:true, order, razorpay_order: rzp, key: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY,
        breakdown:{ food_amount:foodAmount, platform_fee:platformFee, delivery_fee:deliveryFee, tax, total } })
    }
    res.json({ success:true, order, razorpay_order:null, message:"Razorpay keys missing — COD/test",
      breakdown:{ food_amount:foodAmount, platform_fee:platformFee, delivery_fee:deliveryFee, tax, total } })
  } catch (e) { console.log("placeOrder error:", e.message); res.status(500).json({ message: e.message }) }
}

// POST /api/food/order/:id/verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
    const SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET
    // Signature verification is MANDATORY. Reject if secret not configured or signature missing/invalid.
    if (!SECRET) return res.status(500).json({ message: "Payment secret not configured" })
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return res.status(400).json({ message: "Missing payment verification fields" })
    const exp = crypto.createHmac("sha256", SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex")
    if (exp !== razorpay_signature) return res.status(400).json({ message: "Payment verification failed" })
    const r = await pool.query(
      `UPDATE food_orders SET payment_status='paid', payment_id=$1,
         order_status='restaurant_pending'
       WHERE id=$2 RETURNING *`, [razorpay_payment_id||null, req.params.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Order not found" })

    try {
      const { emitNewOrder } = require("../../socket/emit")
      emitNewOrder({ type:"food", id:r.rows[0].id, restaurant_id:r.rows[0].restaurant_id, status:"restaurant_pending" })
    } catch(e){}
    // panel notifications: restaurant owner + admin
    try {
      const notify = require("../../services/notify")
      const own = await pool.query(`SELECT owner_id, restaurant_name FROM food_restaurants WHERE id=$1`, [r.rows[0].restaurant_id])
      if (own.rows[0]?.owner_id) {
        notify({ to: "restaurant", userId: own.rows[0].owner_id, type: "new_order",
                 title: `New food order #${r.rows[0].id}`, message: "Accept within 2 minutes.", data: { food_order_id: r.rows[0].id } })
      }
      notify({ to: "admin", type: "new_order", title: `New food order #${r.rows[0].id}`,
               message: `Food order paid (₹${r.rows[0].total_amount}).`, data: { food_order_id: r.rows[0].id } })
    } catch (e) { console.log("food notify:", e.message) }
    res.json({ success:true, order:r.rows[0] })
  } catch (e) { console.log("verifyPayment(food) error:", e.message); res.status(500).json({ message: e.message }) }
}

// GET /api/food/my-orders
exports.myOrders = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, fr.restaurant_name, u.name AS partner_name, u.phone AS partner_phone
       FROM food_orders o
       LEFT JOIN food_restaurants fr ON fr.id=o.restaurant_id
       LEFT JOIN users u ON u.id=o.delivery_partner_id
       WHERE o.customer_id=$1 ORDER BY o.id DESC`, [req.user.id])
    res.json({ success:true, orders:r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
