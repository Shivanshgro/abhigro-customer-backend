const pool = require("../../config/db")

// Append an audit row and update the order's current status in one place.
async function setStatus(orderId, status, role, userId, remarks = null) {
  await pool.query(
    `UPDATE medicine_orders SET order_status=$1, updated_at=NOW() WHERE id=$2`,
    [status, orderId]
  )
  await pool.query(
    `INSERT INTO medicine_order_status_history(order_id, status, changed_by_role, changed_by_id, remarks)
     VALUES($1,$2,$3,$4,$5)`,
    [orderId, status, role || null, userId || null, remarks]
  )
}

module.exports = { setStatus }
