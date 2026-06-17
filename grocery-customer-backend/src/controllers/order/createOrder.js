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

    // Delivery pincode from address
    let pincode = null
    try {
      const addr = await pool.query(`SELECT pincode FROM addresses WHERE id=$1`, [addr_id])
      pincode = addr.rows[0]?.pincode || null
    } catch (e) { /* ignore */ }

    // Create order
    const order = await pool.query(
      `INSERT INTO orders(user_id, address_id, total_amount, payment_method, delivery_slot, pincode, status, assignment_status)
       VALUES($1,$2,$3,$4,$5,$6,'Confirmed','pending')
       RETURNING *`,
      [user_id, addr_id, total, paymentMethod || "COD", slot, pincode]
    )
    const orderId = order.rows[0].id

    // Save order items (needed for stock matching)
    const items = cart.rows.map(r => ({ product_id: r.product_id, quantity: r.quantity }))
    for (const it of cart.rows) {
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1,$2,$3,$4)`,
        [orderId, it.product_id, it.quantity, it.price])
    }

    // Clear cart
    await pool.query(`DELETE FROM cart WHERE user_id = $1`, [user_id])

    // Auto-assign to nearest vendor that has ALL items in stock
    let assignment = { assigned: false }
    try {
      assignment = await autoAssignOrder(orderId, pincode, items)
    } catch (e) {
      console.log("Auto-assign error:", e.message)
    }

    res.json({ success: true, ...order.rows[0], assigned: assignment.assigned })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = createOrder
