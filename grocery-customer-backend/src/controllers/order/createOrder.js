const pool = require("../../config/db")
const { autoAssignOrder } = require("../vendor/autoAssignService")

const createOrder = async (req, res) => {
  try {
    const { addressId, address_id, deliverySlot, delivery_slot, paymentMethod } = req.body
    const user_id = req.user.id
    const addr_id = addressId || address_id
    const slot = deliverySlot || delivery_slot || null

    const cart = await pool.query(
      `SELECT products.id AS product_id, products.price, cart.quantity
       FROM cart
       JOIN products ON products.id = cart.product_id
       WHERE cart.user_id = $1`,
      [user_id]
    )

    if (cart.rows.length === 0) {
      return res.status(400).json({ message: "Cart is empty" })
    }

    let total = 0
    cart.rows.forEach(item => { total += item.price * item.quantity })

    let pincode = null
    let finalAddrId = addr_id
    try {
      let addr
      if (finalAddrId) {
        addr = await pool.query(`SELECT id, pincode FROM addresses WHERE id=$1`, [finalAddrId])
      }
      if (!addr || addr.rows.length === 0) {
        addr = await pool.query(`SELECT id, pincode FROM addresses WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [user_id])
      }
      if (addr.rows.length > 0) {
        finalAddrId = addr.rows[0].id
        pincode = addr.rows[0].pincode || null
      }
    } catch (e) { console.log("pincode lookup error:", e.message) }

    const isCOD = !paymentMethod || /cod/i.test(paymentMethod)
    const payStatus = isCOD ? "Pending" : "Paid"

    const order = await pool.query(
      `INSERT INTO orders(user_id, address_id, total_amount, payment_method, delivery_slot, pincode, status, assignment_status, payment_status)
       VALUES($1,$2,$3,$4,$5,$6,'Confirmed','pending',$7)
       RETURNING *`,
      [user_id, finalAddrId, total, paymentMethod || "COD", slot, pincode, payStatus]
    )
    const orderId = order.rows[0].id

    const items = cart.rows.map(r => ({ product_id: r.product_id, quantity: r.quantity }))
    for (const it of cart.rows) {
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1,$2,$3,$4)`,
        [orderId, it.product_id, it.quantity, it.price])
    }

    await pool.query(`DELETE FROM cart WHERE user_id = $1`, [user_id])

    let assignment = { assigned: false }
    try {
      assignment = await autoAssignOrder(orderId, pincode, items)
    } catch (e) {
      console.log("Auto-assign error:", e.message)
    }

    // Notify admin (live dashboard + WhatsApp) — non-blocking
    try {
      const { emitNewOrder } = require("../../socket/emit")
      const { sendNewOrderWhatsApp } = require("../../services/whatsappService")
      const info = await pool.query(
        `SELECT u.name AS customer_name, u.phone AS customer_phone,
                a.address_line AS address, s.shop_name AS shop_name
         FROM orders o
         LEFT JOIN users u ON u.id=o.user_id
         LEFT JOIN addresses a ON a.id=o.address_id
         LEFT JOIN shops s ON s.id=o.assigned_shop_id
         WHERE o.id=$1`, [orderId])
      const d = info.rows[0] || {}
      const payload = {
        id: orderId, orderNumber: orderId,
        customerName: d.customer_name, customerPhone: d.customer_phone,
        address: d.address, pincode, totalAmount: total,
        paymentMethod: paymentMethod || "COD", paymentStatus: payStatus,
        shopName: d.shop_name, status: "Confirmed",
      }
      emitNewOrder(payload)
      sendNewOrderWhatsApp(payload) // fire-and-forget
    } catch (e) { console.log("admin notify error:", e.message) }

    res.json({ success: true, ...order.rows[0], assigned: assignment.assigned })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = createOrder
