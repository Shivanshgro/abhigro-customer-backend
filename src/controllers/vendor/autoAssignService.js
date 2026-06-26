const pool = require("../../config/db")

async function findShop(pincode, productIds, useZone) {
  const locationClause = useZone
    ? `s.zone = (SELECT zone FROM pincode_zones WHERE pincode = $1)`
    : `s.pincode = $1`
  const q = `
    SELECT s.id AS shop_id, s.priority_score, SUM(vi.price) AS approx_price
    FROM shops s
    JOIN vendor_inventory vi ON vi.shop_id = s.id
    WHERE s.is_online = true AND s.is_active = true
      AND ${locationClause}
      AND s.orders_today < s.daily_capacity
      AND vi.product_id = ANY($2::int[])
      AND vi.available = true AND vi.stock_qty > 0
    GROUP BY s.id, s.priority_score
    HAVING COUNT(DISTINCT vi.product_id) = $3
    ORDER BY s.priority_score DESC, approx_price ASC
    LIMIT 1`
  const r = await pool.query(q, [pincode, productIds, productIds.length])
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
    return { assigned: false, reason: "no online vendor with all items in stock" }
  }

  const shopId = shop.shop_id
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `UPDATE orders SET assigned_shop_id=$1, assignment_status='assigned', status='Confirmed' WHERE id=$2`,
      [shopId, orderId])
    for (const it of items) {
      await client.query(
        `UPDATE vendor_inventory SET stock_qty = GREATEST(0, stock_qty - $1),
         available = (stock_qty - $1) > 0, updated_at = NOW()
         WHERE shop_id=$2 AND product_id=$3`,
        [it.quantity || 1, shopId, it.product_id])
    }
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
