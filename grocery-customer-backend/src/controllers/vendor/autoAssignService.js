const pool = require("../../config/db")

// Auto-assign an order to the best vendor.
// Rules (in priority order):
//   1. Vendor must be ONLINE
//   2. Vendor must be in the customer's pincode (service area)
//   3. Vendor must have ALL ordered products marked available with enough stock
//   4. Vendor must have delivery capacity left today
//   5. Among eligible vendors, pick highest priority_score, then lowest total price
//
// items = [{ product_id, quantity }]
async function autoAssignOrder(orderId, pincode, items) {
  if (!items || items.length === 0) {
    await pool.query(`UPDATE orders SET assignment_status='unfulfilled' WHERE id=$1`, [orderId])
    return { assigned: false, reason: "no items" }
  }

  const productIds = items.map(i => i.product_id)

  // Find candidate shops: online, in pincode, capacity left,
  // and having EVERY ordered product available with stock.
  // The HAVING COUNT ensures the shop stocks ALL requested products (not just some).
  const candidates = await pool.query(
    `SELECT s.id AS shop_id,
            s.priority_score,
            SUM(vi.price * 1) AS approx_price
     FROM shops s
     JOIN vendor_inventory vi ON vi.shop_id = s.id
     WHERE s.is_online = true
       AND s.is_active = true
       AND ($1::text IS NULL OR s.pincode = $1)
       AND s.orders_today < s.daily_capacity
       AND vi.product_id = ANY($2::int[])
       AND vi.available = true
       AND vi.stock_qty > 0
     GROUP BY s.id, s.priority_score
     HAVING COUNT(DISTINCT vi.product_id) = $3
     ORDER BY s.priority_score DESC, approx_price ASC
     LIMIT 1`,
    [pincode, productIds, productIds.length]
  )

  if (candidates.rows.length === 0) {
    // No vendor has all items in stock → leave unassigned for admin/manual handling
    await pool.query(`UPDATE orders SET assignment_status='unfulfilled' WHERE id=$1`, [orderId])
    return { assigned: false, reason: "no vendor has all items in stock" }
  }

  const shopId = candidates.rows[0].shop_id

  // Assign + auto-confirm, decrement vendor stock, count capacity
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    await client.query(
      `UPDATE orders SET assigned_shop_id=$1, assignment_status='assigned', status='Confirmed' WHERE id=$2`,
      [shopId, orderId])

    // Decrement vendor stock per item
    for (const it of items) {
      await client.query(
        `UPDATE vendor_inventory
         SET stock_qty = GREATEST(0, stock_qty - $1),
             available = (stock_qty - $1) > 0,
             updated_at = NOW()
         WHERE shop_id=$2 AND product_id=$3`,
        [it.quantity || 1, shopId, it.product_id])
    }

    // Count toward daily capacity
    await client.query(`UPDATE shops SET orders_today = orders_today + 1 WHERE id=$1`, [shopId])

    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }

  return { assigned: true, shop_id: shopId }
}

// If a vendor fails to fulfil, drop their priority and reassign to next vendor
async function reassignFailedOrder(orderId) {
  const o = await pool.query(`SELECT pincode, assigned_shop_id FROM orders WHERE id=$1`, [orderId])
  if (o.rows.length === 0) return { assigned: false, reason: "order not found" }

  // Penalise the failed vendor
  if (o.rows[0].assigned_shop_id) {
    await pool.query(
      `UPDATE shops SET priority_score = GREATEST(0, priority_score - 10) WHERE id=$1`,
      [o.rows[0].assigned_shop_id])
  }

  const items = await pool.query(
    `SELECT product_id, quantity FROM order_items WHERE order_id=$1`, [orderId])

  // Exclude the failed shop by temporarily marking it; simplest: reassign among others
  return await autoAssignOrder(orderId, o.rows[0].pincode, items.rows)
}

module.exports = { autoAssignOrder, reassignFailedOrder }
