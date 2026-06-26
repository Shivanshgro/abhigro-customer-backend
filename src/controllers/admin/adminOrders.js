const pool = require("../../config/db")

// GET /api/admin/orders?status=&limit=&offset=
// Full order list for the Admin dashboard with all required fields.
exports.listOrders = async (req, res) => {
  try {
    const { status } = req.query
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    const offset = parseInt(req.query.offset) || 0

    const params = []
    let where = ""
    if (status) { params.push(status); where = `WHERE o.status = $${params.length}` }
    params.push(limit); params.push(offset)

    const rows = await pool.query(
      `SELECT
         o.id AS order_number,
         o.id,
         u.name  AS customer_name,
         u.phone AS customer_phone,
         a.address_line AS delivery_address,
         o.pincode,
         o.total_amount,
         o.payment_method,
         o.payment_status,
         o.status,
         o.assignment_status,
         s.id   AS shop_id,
         s.shop_name AS assigned_shop,
         s.phone AS shop_phone,
         o.delivery_boy_id,
         o.packed_photo,
         o.delivery_photo,
         o.created_at
       FROM orders o
       LEFT JOIN users u    ON u.id = o.user_id
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN shops s    ON s.id = o.assigned_shop_id
       ${where}
       ORDER BY o.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ success: true, count: rows.rows.length, orders: rows.rows })
  } catch (e) {
    console.log("admin listOrders error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// GET /api/admin/orders/:id — full detail incl. items
exports.getOrder = async (req, res) => {
  try {
    const { id } = req.params
    const order = await pool.query(
      `SELECT o.*, u.name AS customer_name, u.phone AS customer_phone,
              a.address_line AS delivery_address,
              s.shop_name AS assigned_shop, s.phone AS shop_phone, s.address AS shop_address
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN shops s ON s.id = o.assigned_shop_id
       WHERE o.id = $1`, [id])
    if (order.rows.length === 0) return res.status(404).json({ message: "Order not found" })

    const items = await pool.query(
      `SELECT oi.product_id, p.name AS product_name, oi.quantity, oi.price
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`, [id])

    res.json({ success: true, order: { ...order.rows[0], items: items.rows } })
  } catch (e) {
    console.log("admin getOrder error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
