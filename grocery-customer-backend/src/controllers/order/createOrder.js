const pool = require("../../config/db")

const createOrder = async (req, res) => {
  try {
    const { addressId, address_id, deliverySlot, delivery_slot, paymentMethod } = req.body
    const user_id = req.user.id
    const addr_id = addressId || address_id
    const slot = deliverySlot || delivery_slot || null

    // Get cart items with product prices
    const cart = await pool.query(
      `SELECT products.price, cart.quantity, cart.id AS cart_row_id
       FROM cart
       JOIN products ON products.id = cart.product_id
       WHERE cart.user_id = $1`,
      [user_id]
    )

    if (cart.rows.length === 0) {
      return res.status(400).json({ message: "Cart is empty" })
    }

    // Calculate total
    let total = 0
    cart.rows.forEach(item => { total += item.price * item.quantity })

    // Create the order
    const order = await pool.query(
      `INSERT INTO orders(user_id, address_id, total_amount, payment_method, delivery_slot, status)
       VALUES($1, $2, $3, $4, $5, 'Confirmed')
       RETURNING *`,
      [user_id, addr_id, total, paymentMethod || "COD", slot]
    )

    // Clear cart — delete cart_items FIRST (child), then cart rows (parent)
    const cartIds = cart.rows.map(r => r.cart_row_id)

    if (cartIds.length > 0) {
      // If using cart_items table (separate child table)
      await pool.query(
        `DELETE FROM cart_items WHERE cart_id IN (
           SELECT id FROM cart WHERE user_id = $1
         )`,
        [user_id]
      ).catch(() => {
        // cart_items table may not exist in this schema — ignore
      })

      // Now safe to delete cart rows
      await pool.query(`DELETE FROM cart WHERE user_id = $1`, [user_id])
    }

    res.json({ success: true, ...order.rows[0] })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = createOrder