const pool = require("../../config/db")
const { autoAssignOrder } = require("../vendor/autoAssignService")
const { distanceKm, deliveryFee } = require("../../utils/distance")
const { getDeliverySettings } = require("../../utils/settings")

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

    let subtotal = 0
    cart.rows.forEach(item => { subtotal += item.price * item.quantity })

    let pincode = null
    let finalAddrId = addr_id
    let custLat = null, custLng = null
    try {
      let addr
      if (finalAddrId) {
        addr = await pool.query(`SELECT id, pincode, latitude, longitude FROM addresses WHERE id=$1`, [finalAddrId])
      }
      if (!addr || addr.rows.length === 0) {
        addr = await pool.query(`SELECT id, pincode, latitude, longitude FROM addresses WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [user_id])
      }
      if (addr.rows.length > 0) {
        finalAddrId = addr.rows[0].id
        pincode = addr.rows[0].pincode || null
        custLat = addr.rows[0].latitude
        custLng = addr.rows[0].longitude
      }
    } catch (e) { console.log("pincode lookup error:", e.message) }

    // --- Delivery fee: same logic as the /orders/quote endpoint, computed server-side ---
    let delivery_fee = 0
    try {
      const settings = await getDeliverySettings()
      const free = settings.free_delivery_above_order > 0 && subtotal >= settings.free_delivery_above_order
      if (!free) {
        // distance from nearest active shop (fallback) to customer
        let sLat = null, sLng = null
        const shop = await pool.query(`SELECT latitude, longitude FROM shops WHERE is_active=true AND latitude IS NOT NULL ORDER BY id LIMIT 1`)
        if (shop.rows.length > 0) { sLat = shop.rows[0].latitude; sLng = shop.rows[0].longitude }
        const d = distanceKm(sLat, sLng, custLat, custLng)
        delivery_fee = deliveryFee(d, {
          baseFee: settings.delivery_base_fee, perKm: settings.delivery_per_km,
          freeAboveKm: settings.delivery_free_above_km, minFee: settings.delivery_min_fee,
          maxFee: settings.delivery_max_fee, surge: settings.delivery_surge,
        })
      }
    } catch (e) { console.log("delivery fee calc error:", e.message); delivery_fee = 0 }

    const total = Math.round((subtotal + Number(delivery_fee)) * 100) / 100

    const isCOD = !paymentMethod || /cod/i.test(paymentMethod)
    const payStatus = isCOD ? "Pending" : "Paid"

    const order = await pool.query(
      `INSERT INTO orders(user_id, address_id, total_amount, delivery_fee, payment_method, delivery_slot, pincode, status, assignment_status, payment_status, delivery_instructions, replacement_preference)
       VALUES($1,$2,$3,$4,$5,$6,$7,'Confirmed','pending',$8,$9,$10)
       RETURNING *`,
      [user_id, finalAddrId, total, delivery_fee, paymentMethod || "COD", slot, pincode, payStatus,
       req.body.delivery_instructions || null, req.body.replacement_preference || null]
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

    // Notify admin dashboard live (socket only — free, no WhatsApp)
    try {
      // panel notifications: assigned vendor + admin (stored + live)
      try {
        const notify = require("../../services/notify")
        const shopOwner = await pool.query(`SELECT s.owner_user_id, s.shop_name FROM orders o JOIN shops s ON s.id=o.assigned_shop_id WHERE o.id=$1`, [order.id])
        if (shopOwner.rows[0]?.owner_user_id) {
          notify({ to: "vendor", userId: shopOwner.rows[0].owner_user_id, type: "new_order",
                   title: `New order #${order.id}`, message: `You have a new order to pack.`, data: { order_id: order.id } })
        }
        notify({ to: "admin", type: "new_order", title: `New order #${order.id}`,
                 message: `Customer order placed (₹${order.total_amount}).`, data: { order_id: order.id } })
      } catch (e) { console.log("order notify:", e.message) }

      const { emitNewOrder } = require("../../socket/emit")
      const info = await pool.query(
        `SELECT u.name AS customer_name, u.phone AS customer_phone,
                a.address_line AS address, s.shop_name AS shop_name
         FROM orders o
         LEFT JOIN users u ON u.id=o.user_id
         LEFT JOIN addresses a ON a.id=o.address_id
         LEFT JOIN shops s ON s.id=o.assigned_shop_id
         WHERE o.id=$1`, [orderId])
      const d = info.rows[0] || {}
      emitNewOrder({
        id: orderId, orderNumber: orderId,
        customerName: d.customer_name, customerPhone: d.customer_phone,
        address: d.address, pincode, totalAmount: total,
        paymentMethod: paymentMethod || "COD", paymentStatus: payStatus,
        shopName: d.shop_name, status: "Confirmed",
      })
    } catch (e) { console.log("admin notify error:", e.message) }

    res.json({ success: true, ...order.rows[0], assigned: assignment.assigned })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = createOrder