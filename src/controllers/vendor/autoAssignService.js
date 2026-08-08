const pool = require("../../config/db")

// Vendors are fulfillment partners - they do NOT maintain stock.
// Shop selection is by location + online status + capacity only.
// (Stock/inventory is managed centrally by the Admin Panel.)
async function findShop(pincode, productIds, useZone) {
  const locationClause = useZone
    ? `s.zone = (SELECT zone FROM pincode_zones WHERE pincode = $1)`
    : `s.pincode = $1`
  const q = `
    SELECT s.id AS shop_id, s.priority_score
    FROM shops s
    WHERE s.is_online = true AND s.is_active = true
      AND ${locationClause}
      AND s.orders_today < s.daily_capacity
    ORDER BY s.priority_score DESC, s.id ASC
    LIMIT 1`
  const r = await pool.query(q, [pincode])
  return r.rows[0] || null
}

async function autoAssignOrder(orderId, pincode, items) {
  if (!items || items.length === 0 || !pincode) {
    await pool.query(`UPDATE orders SET assignment_status='unfulfilled' WHERE id=$1`, [orderId])
    return { assigned: false, reason: "no items or no pincode" }
  }
  const productIds = items.map(i => i.product_id)
  let shop = await findShop(pincode, productIds, false)
  let matchedBy = "same pincode"
  if (!shop) {
    shop = await findShop(pincode, productIds, true)
    matchedBy = "nearby zone"
  }
  if (!shop) {
    await pool.query(`UPDATE orders SET assignment_status='unfulfilled' WHERE id=$1`, [orderId])
    return { assigned: false, reason: "no online vendor available in this area" }
  }
  const shopId = shop.shop_id
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `UPDATE orders SET assigned_shop_id=$1, assignment_status='assigned', status='Confirmed' WHERE id=$2`,
      [shopId, orderId])
    await client.query(`UPDATE shops SET orders_today = orders_today + 1 WHERE id=$1`, [shopId])
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK"); throw e
  } finally { client.release() }
  return { assigned: true, shop_id: shopId, matched_by: matchedBy }
}

async function reassignFailedOrder(orderId) {
  const o = await pool.query(`SELECT pincode, assigned_shop_id FROM orders WHERE id=$1`, [orderId])
  if (o.rows.length === 0) return { assigned: false, reason: "order not found" }
  if (o.rows[0].assigned_shop_id) {
    await pool.query(`UPDATE shops SET priority_score = GREATEST(0, priority_score - 10) WHERE id=$1`,
      [o.rows[0].assigned_shop_id])
  }
  const items = await pool.query(`SELECT product_id, quantity FROM order_items WHERE order_id=$1`, [orderId])
  return await autoAssignOrder(orderId, o.rows[0].pincode, items.rows)
}

module.exports = { autoAssignOrder, reassignFailedOrder }