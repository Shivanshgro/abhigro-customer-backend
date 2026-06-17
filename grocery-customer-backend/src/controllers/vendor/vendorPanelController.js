const pool = require("../../config/db")
const { bookDelivery, PROVIDER } = require("../../services/delivery/deliveryProvider")

async function getMyShop(userId) {
  const r = await pool.query(`SELECT * FROM shops WHERE owner_user_id=$1 LIMIT 1`, [userId])
  return r.rows[0] || null
}

// GET /api/vendor/inventory — vendor's stock list
exports.getInventory = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked to this account" })
    const inv = await pool.query(
      `SELECT vi.*, p.name AS product_name, p.image, p.unit, p.price AS catalog_price
       FROM vendor_inventory vi
       JOIN products p ON p.id = vi.product_id
       WHERE vi.shop_id=$1 ORDER BY p.name`,
      [shop.id])
    res.json({ success: true, shop, inventory: inv.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/vendor/inventory — add/update a product's stock & availability
exports.updateInventory = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })
    const { product_id, available, stock_qty, price } = req.body
    if (!product_id) return res.status(400).json({ message: "product_id required" })

    const result = await pool.query(
      `INSERT INTO vendor_inventory (shop_id, product_id, available, stock_qty, price, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (shop_id, product_id)
       DO UPDATE SET available=EXCLUDED.available, stock_qty=EXCLUDED.stock_qty,
                     price=EXCLUDED.price, updated_at=NOW()
       RETURNING *`,
      [shop.id, product_id, available !== false, stock_qty || 0, price || null])
    res.json({ success: true, item: result.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/vendor/inventory/bulk — update many at once (daily duty)
exports.bulkUpdateInventory = async (req, res) => {
  const client = await pool.connect()
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })
    const { items } = req.body  // [{product_id, available, stock_qty, price}]
    if (!Array.isArray(items)) return res.status(400).json({ message: "items array required" })

    await client.query("BEGIN")
    for (const it of items) {
      await client.query(
        `INSERT INTO vendor_inventory (shop_id, product_id, available, stock_qty, price, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (shop_id, product_id)
         DO UPDATE SET available=EXCLUDED.available, stock_qty=EXCLUDED.stock_qty,
                       price=EXCLUDED.price, updated_at=NOW()`,
        [shop.id, it.product_id, it.available !== false, it.stock_qty || 0, it.price || null])
    }
    await client.query("COMMIT")
    res.json({ success: true, updated: items.length })
  } catch (e) {
    await client.query("ROLLBACK")
    res.status(500).json({ message: e.message })
  } finally { client.release() }
}

// POST /api/vendor/status — go online/offline
exports.setStatus = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })
    const { is_online } = req.body
    await pool.query(`UPDATE shops SET is_online=$1 WHERE id=$2`, [is_online, shop.id])
    res.json({ success: true, is_online })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/vendor/orders — orders auto-assigned to this vendor
exports.myOrders = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })
    const orders = await pool.query(
      `SELECT o.*, 
        (SELECT json_agg(json_build_object('product_id',oi.product_id,'quantity',oi.quantity))
         FROM order_items oi WHERE oi.order_id=o.id) AS items
       FROM orders o WHERE o.assigned_shop_id=$1 ORDER BY o.id DESC`,
      [shop.id])
    res.json({ success: true, orders: orders.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/vendor/orders/:id/fulfilled — mark packed + auto-book delivery
exports.markFulfilled = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })
    const { id } = req.params

    await pool.query(
      `UPDATE orders SET status='Packed' WHERE id=$1 AND assigned_shop_id=$2`,
      [id, shop.id])

    // Auto-book third-party delivery: pickup = vendor shop, drop = customer address
    try {
      const ord = await pool.query(
        `SELECT o.*, a.address_line, a.phone AS cust_phone
         FROM orders o LEFT JOIN addresses a ON a.id = o.address_id
         WHERE o.id=$1`, [id])
      const o = ord.rows[0]
      const pickup = { address: shop.address || "", phone: shop.phone || "" }
      const drop   = { address: o?.address_line || "", phone: o?.cust_phone || "" }

      const booking = await bookDelivery(pickup, drop, o || { id })
      await pool.query(
        `UPDATE orders SET delivery_tracking_id=$1, delivery_provider=$2, delivery_booked_status=$3,
           status = CASE WHEN $3='booked' THEN 'Out For Delivery' ELSE status END
         WHERE id=$4`,
        [booking.trackingId, PROVIDER, booking.status, id])

      return res.json({ success: true, delivery: booking })
    } catch (e) {
      return res.json({ success: true, delivery: { status: "failed", error: e.message } })
    }
  } catch (e) { res.status(500).json({ message: e.message }) }
}
