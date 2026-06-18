const pool = require("../../config/db")

exports.availableOrders = async (req, res) => {
  try {
    const orders = await pool.query(
      `SELECT o.id, o.total_amount, o.pincode, o.status, o.payment_method,
              s.shop_name, s.address AS shop_address, s.phone AS shop_phone,
              a.address_line AS customer_address, a.phone AS customer_phone
       FROM orders o
       LEFT JOIN shops s ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       WHERE o.status = '"'"'Packed'"'"' AND (o.delivery_boy_id IS NULL)
       ORDER BY o.id DESC`
    )
    res.json({ success: true, orders: orders.rows })
  } catch (e) {
    console.log("availableOrders error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

exports.myDeliveries = async (req, res) => {
  try {
    const orders = await pool.query(
      `SELECT o.id, o.total_amount, o.pincode, o.status, o.payment_method,
              s.shop_name, s.address AS shop_address, s.phone AS shop_phone,
              a.address_line AS customer_address, a.phone AS customer_phone
       FROM orders o
       LEFT JOIN shops s ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       WHERE o.delivery_boy_id = $1 AND o.status IN ('"'"'Out For Delivery'"'"','"'"'Packed'"'"')
       ORDER BY o.id DESC`,
      [req.user.id]
    )
    res.json({ success: true, orders: orders.rows })
  } catch (e) {
    console.log("myDeliveries error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

exports.goToPickup = async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      `UPDATE orders SET delivery_boy_id = $1
       WHERE id = $2 AND status = '"'"'Packed'"'"' AND delivery_boy_id IS NULL
       RETURNING id`,
      [req.user.id, id]
    )
    if (result.rows.length === 0) return res.status(400).json({ message: "Order already taken or not available" })
    res.json({ success: true, message: "Assigned to you. Head to the shop." })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

exports.markPickedUp = async (req, res) => {
  try {
    const { id } = req.params
    await pool.query(`UPDATE orders SET status = '"'"'Out For Delivery'"'"' WHERE id = $1 AND delivery_boy_id = $2`, [id, req.user.id])
    res.json({ success: true, message: "Out for delivery" })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

exports.markDelivered = async (req, res) => {
  try {
    const { id } = req.params
    await pool.query(`UPDATE orders SET status = '"'"'Completed'"'"' WHERE id = $1 AND delivery_boy_id = $2`, [id, req.user.id])
    res.json({ success: true, message: "Delivered. Order completed!" })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
