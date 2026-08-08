// fulfillmentMirror.js
// Phase A/B (additive, non-breaking): mirror a newly created order into the new
// parent_orders / fulfillment_orders model, alongside the existing flow.

const pool = require("../../config/db")

async function categorizeItems(items) {
  if (!items || items.length === 0) return {}
  const ids = items.map(i => i.product_id)
  let cats = {}
  try {
    const r = await pool.query(
      `SELECT p.id AS product_id, COALESCE(c.name, 'grocery') AS category
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ANY($1::int[])`,
      [ids]
    )
    for (const row of r.rows) cats[row.product_id] = row.category
  } catch (e) {}
  const grouped = {}
  for (const it of items) {
    const cat = cats[it.product_id] || "grocery"
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(it)
  }
  return grouped
}

async function mirrorOrder({ legacyOrderId, userId, pincode, lat, lng, total, items, assignedShopId }) {
  const grouped = await categorizeItems(items)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const parent = await client.query(
      `INSERT INTO parent_orders (legacy_order_id, customer_id, latitude, longitude, total, overall_status)
       VALUES ($1,$2,$3,$4,$5,'placed') RETURNING id`,
      [legacyOrderId, userId, lat, lng, total]
    )
    const parentId = parent.rows[0].id
    let flocId = null
    if (assignedShopId) {
      const fl = await client.query(`SELECT id FROM fulfillment_locations WHERE shop_id = $1 LIMIT 1`, [assignedShopId])
      flocId = fl.rows[0]?.id || null
    }
    for (const [category, catItems] of Object.entries(grouped)) {
      const ford = await client.query(
        `INSERT INTO fulfillment_orders (parent_order_id, fulfillment_location_id, category, status)
         VALUES ($1,$2,$3,'created') RETURNING id`,
        [parentId, flocId, category]
      )
      const fordId = ford.rows[0].id
      for (const it of catItems) {
        await client.query(
          `INSERT INTO fulfillment_order_items (fulfillment_order_id, product_id, quantity) VALUES ($1,$2,$3)`,
          [fordId, it.product_id, it.quantity || 1]
        )
      }
    }
    await client.query("COMMIT")
    return { mirrored: true, parent_order_id: parentId, groups: Object.keys(grouped) }
  } catch (e) {
    await client.query("ROLLBACK")
    return { mirrored: false, reason: e.message }
  } finally {
    client.release()
  }
}

module.exports = { mirrorOrder }