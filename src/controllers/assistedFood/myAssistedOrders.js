const pool = require("../../config/db")
// GET /api/assisted-food/my — customer's assisted orders with live status
const myAssistedOrders = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.*, u.name AS partner_name, u.phone AS partner_phone
       FROM assisted_food_orders a
       LEFT JOIN users u ON u.id = a.delivery_boy_id
       WHERE a.user_id=$1 ORDER BY a.id DESC`, [req.user.id])
    res.json({ success: true, orders: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
module.exports = myAssistedOrders
