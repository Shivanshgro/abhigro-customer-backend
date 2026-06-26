const pool = require("../../config/db")

// POST /api/orders/:id/reorder — adds the order's (non-cancelled) items into the flat cart.
const reorder = async (req, res) => {
  try {
    const userId = req.user.id
    const orderId = req.params.id

    const o = await pool.query(`SELECT id FROM orders WHERE id=$1 AND user_id=$2`, [orderId, userId])
    if (o.rows.length === 0) return res.status(404).json({ message: "Order not found" })

    const items = await pool.query(
      `SELECT product_id, quantity FROM order_items WHERE order_id=$1 AND cancelled=false`, [orderId]
    )
    if (items.rows.length === 0) return res.status(400).json({ message: "No items to reorder" })

    let added = 0
    for (const it of items.rows) {
      // skip products that no longer exist / inactive
      const p = await pool.query(`SELECT id FROM products WHERE id=$1`, [it.product_id])
      if (p.rows.length === 0) continue
      const existing = await pool.query(
        `SELECT id, quantity FROM cart WHERE user_id=$1 AND product_id=$2`, [userId, it.product_id]
      )
      if (existing.rows.length > 0) {
        await pool.query(`UPDATE cart SET quantity = quantity + $1 WHERE id=$2`, [it.quantity, existing.rows[0].id])
      } else {
        await pool.query(`INSERT INTO cart(user_id, product_id, quantity) VALUES($1,$2,$3)`, [userId, it.product_id, it.quantity])
      }
      added++
    }
    res.json({ success: true, added })
  } catch (e) {
    console.log("reorder error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = reorder
