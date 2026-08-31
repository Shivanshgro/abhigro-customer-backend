const pool = require("../../config/db")
const { bookDelivery, PROVIDER } = require("../../services/delivery/deliveryProvider")
const cloudinary = require("../../config/cloudinary")
const { notifyDeliveryBoys } = require("../../services/notificationService")

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
    // A vendor may change how much they have and whether it is available.
    // They may not add a product to the catalogue, and they may not set the
    // price - both belong to AbhiGro so the catalogue stays consistent
    // across every store. `price` in the body is deliberately ignored.
    const { product_id, available, stock_qty } = req.body
    if (!product_id) return res.status(400).json({ message: "product_id required" })

    const result = await pool.query(
      `UPDATE vendor_inventory
       SET available = $3, stock_qty = $4, updated_at = NOW()
       WHERE shop_id = $1 AND product_id = $2
       RETURNING *`,
      [shop.id, product_id, available !== false, Math.max(0, Number(stock_qty) || 0)])

    if (result.rows.length === 0) {
      return res.status(403).json({
        message: "This product is not in your list. Ask the AbhiGro team to add it.",
        needsRequest: true,
      })
    }
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

    // Same rule as the single update: existing rows only, price untouched.
    await client.query("BEGIN")
    let updated = 0, skipped = []
    for (const it of items) {
      const r = await client.query(
        `UPDATE vendor_inventory
         SET available = $3, stock_qty = $4, updated_at = NOW()
         WHERE shop_id = $1 AND product_id = $2`,
        [shop.id, it.product_id, it.available !== false, Math.max(0, Number(it.stock_qty) || 0)])
      if (r.rowCount > 0) updated++
      else skipped.push(it.product_id)
    }
    await client.query("COMMIT")
    res.json({ success: true, updated, skipped })
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

// GET /api/vendor/orders — orders auto-assigned to this vendor, FULL detail
// Returns each order with: itemised products (name, image, unit, qty, unit price,
// line total), customer name/phone, delivery address + pincode, payment method/status,
// and order totals — everything the vendor needs to pack and dispatch.
exports.myOrders = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })
    const orders = await pool.query(
      `SELECT o.id, o.status, o.total_amount, o.delivery_fee,
              o.payment_method, o.payment_status, o.created_at, o.pincode,
              o.packed_photo, o.delivery_boy_id,
              cu.name  AS customer_name,
              cu.phone AS customer_phone,
              a.address_line, a.pincode AS address_pincode, a.phone AS address_phone,
              (SELECT json_agg(json_build_object(
                  'product_id', oi.product_id,
                  'name',       p.name,
                  'image',      p.image,
                  'unit',       p.unit,
                  'quantity',   oi.quantity,
                  'price',      oi.price,
                  'line_total', (oi.price * oi.quantity),
                  'cancelled',  COALESCE(oi.cancelled,false)
                ) ORDER BY p.name)
               FROM order_items oi
               JOIN products p ON p.id = oi.product_id
               WHERE oi.order_id = o.id) AS items,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS item_count
       FROM orders o
       LEFT JOIN users cu      ON cu.id = o.user_id
       LEFT JOIN addresses a   ON a.id = o.address_id
       WHERE o.assigned_shop_id=$1
       ORDER BY o.id DESC`,
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

    // Notify available delivery boys that a packed order is ready for pickup.
    // Non-blocking: never let a notification failure break the packed flow.
    try {
      const o = await pool.query(`SELECT id, pincode, total_amount FROM orders WHERE id=$1`, [id])
      if (o.rows[0]) {
        await notifyDeliveryBoys(
          o.rows[0],
          "Order ready for pickup",
          `Order #${id} is packed and ready for pickup at ${shop.shop_name || "the shop"}.`
        )
      }
    } catch (e) { console.log("notify delivery boys error:", e.message) }

    // panel notification: broadcast to all delivery partners (stored + live)
    try {
      require("../../services/notify")({ to: "delivery", userId: null, type: "order_packed",
        title: `Order #${id} ready for pickup`,
        message: `Packed at ${shop.shop_name || "the shop"} — accept to deliver.`,
        data: { order_id: Number(id) } })
    } catch (e) {}

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

// POST /api/vendor/orders/:id/packed-photo — vendor uploads proof photo of the
// packed order (multipart field name: "photo" or "image"). Stored on the order.
exports.uploadPackedPhoto = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })
    const { id } = req.params
    const file = req.file || (req.files && req.files[0])
    if (!file) return res.status(400).json({ message: "No photo uploaded" })

    // Make sure this order really belongs to this vendor
    const own = await pool.query(
      `SELECT id FROM orders WHERE id=$1 AND assigned_shop_id=$2`, [id, shop.id])
    if (own.rows.length === 0) return res.status(404).json({ message: "Order not found for this shop" })

    const base64 = file.buffer.toString("base64")
    const dataURI = `data:${file.mimetype};base64,${base64}`
    const result = await cloudinary.uploader.upload(dataURI, { folder: "grocery/packed" })

    await pool.query(`UPDATE orders SET packed_photo=$1 WHERE id=$2`, [result.secure_url, id])
    res.json({ success: true, packed_photo: result.secure_url })
  } catch (e) {
    console.log("uploadPackedPhoto error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/vendor/sales?days=7 — what the shop sold, day by day.
// Pure aggregation over orders that already exist. No new tables.
// ─────────────────────────────────────────────────────────────────────────
exports.getSales = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })

    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7))

    // Commission is read from settings so finance can change it without a
    // deploy, and falls back to a sane default if unset.
    let commissionPct = 10
    try {
      const c = await pool.query(`SELECT value FROM app_settings WHERE key='vendor_commission_pct'`)
      if (c.rows[0]) commissionPct = Number(c.rows[0].value) || commissionPct
    } catch (e) { /* default */ }

    const daily = await pool.query(
      `SELECT DATE(created_at) AS day,
              COUNT(*)::int                                        AS orders,
              COUNT(*) FILTER (WHERE status = 'Completed')::int    AS delivered,
              COUNT(*) FILTER (WHERE status ILIKE '%cancel%')::int AS cancelled,
              COALESCE(SUM(total_amount) FILTER (WHERE status = 'Completed'), 0) AS sales
       FROM orders
       WHERE assigned_shop_id = $1
         AND created_at >= NOW() - ($2 || ' days')::interval
       GROUP BY DATE(created_at)
       ORDER BY day DESC`,
      [shop.id, String(days)])

    const rows = daily.rows.map(r => {
      const sales = Number(r.sales || 0)
      const commission = Math.round(sales * commissionPct) / 100
      return {
        day: r.day,
        orders: r.orders,
        delivered: r.delivered,
        cancelled: r.cancelled,
        sales,
        commission,
        payout: Math.round((sales - commission) * 100) / 100,
      }
    })

    const tot = rows.reduce((a, r) => ({
      orders: a.orders + r.orders,
      delivered: a.delivered + r.delivered,
      cancelled: a.cancelled + r.cancelled,
      sales: a.sales + r.sales,
      commission: a.commission + r.commission,
      payout: a.payout + r.payout,
    }), { orders: 0, delivered: 0, cancelled: 0, sales: 0, commission: 0, payout: 0 })

    // Top sellers over the same window.
    let top = []
    try {
      const t = await pool.query(
        `SELECT p.name, SUM(oi.quantity)::int AS qty,
                COALESCE(SUM(oi.price * oi.quantity), 0) AS value
         FROM order_items oi
         JOIN orders o   ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         WHERE o.assigned_shop_id = $1
           AND o.status = 'Completed'
           AND o.created_at >= NOW() - ($2 || ' days')::interval
         GROUP BY p.name ORDER BY qty DESC LIMIT 8`,
        [shop.id, String(days)])
      top = t.rows.map(x => ({ name: x.name, qty: x.qty, value: Number(x.value || 0) }))
    } catch (e) { console.log("vendor sales top:", e.message) }

    res.json({
      success: true, days, commission_pct: commissionPct,
      totals: {
        ...tot,
        sales: Math.round(tot.sales * 100) / 100,
        commission: Math.round(tot.commission * 100) / 100,
        payout: Math.round(tot.payout * 100) / 100,
        avg_basket: tot.delivered ? Math.round(tot.sales / tot.delivered) : 0,
      },
      daily: rows, top_products: top,
    })
  } catch (e) {
    console.log("getSales error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/vendor/ratings — what customers said about this shop.
//
// Two sources, because customers rate two different things:
//   order_ratings   target='vendor'  -> the shop itself
//   product_reviews                  -> individual products
// Delivery ratings are deliberately NOT included: a slow rider is not the
// shop's fault and counting it against them would be unfair.
// ─────────────────────────────────────────────────────────────────────────
exports.getRatings = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })

    let shopAvg = null, shopCount = 0, recent = []
    try {
      const r = await pool.query(
        `SELECT ROUND(AVG(r.stars)::numeric, 1) AS avg, COUNT(*)::int AS n
         FROM order_ratings r
         JOIN orders o ON o.id = r.order_id
         WHERE o.assigned_shop_id = $1 AND r.target = 'vendor'`, [shop.id])
      shopAvg = r.rows[0]?.avg != null ? Number(r.rows[0].avg) : null
      shopCount = r.rows[0]?.n || 0

      const rec = await pool.query(
        `SELECT r.stars, r.feedback, r.created_at, r.order_id, u.name AS customer
         FROM order_ratings r
         JOIN orders o ON o.id = r.order_id
         LEFT JOIN users u ON u.id = r.user_id
         WHERE o.assigned_shop_id = $1 AND r.target = 'vendor'
         ORDER BY r.created_at DESC LIMIT 20`, [shop.id])
      recent = rec.rows
    } catch (e) { console.log("vendor ratings shop:", e.message) }

    let productAvg = null, productCount = 0, products = []
    try {
      const p = await pool.query(
        `SELECT ROUND(AVG(pr.rating)::numeric, 1) AS avg, COUNT(*)::int AS n
         FROM product_reviews pr
         JOIN orders o ON o.id = pr.order_id
         WHERE o.assigned_shop_id = $1`, [shop.id])
      productAvg = p.rows[0]?.avg != null ? Number(p.rows[0].avg) : null
      productCount = p.rows[0]?.n || 0

      const pl = await pool.query(
        `SELECT pd.name, ROUND(AVG(pr.rating)::numeric, 1) AS avg, COUNT(*)::int AS n
         FROM product_reviews pr
         JOIN orders o    ON o.id = pr.order_id
         JOIN products pd ON pd.id = pr.product_id
         WHERE o.assigned_shop_id = $1
         GROUP BY pd.name ORDER BY AVG(pr.rating) ASC LIMIT 10`, [shop.id])
      products = pl.rows.map(x => ({ name: x.name, avg: Number(x.avg), count: x.n }))
    } catch (e) { console.log("vendor ratings products:", e.message) }

    res.json({
      success: true,
      shop_rating: shopAvg, shop_reviews: shopCount,
      product_rating: productAvg, product_reviews: productCount,
      recent, products,
    })
  } catch (e) {
    console.log("getRatings error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/vendor/payouts — settlements, plus what is building right now.
//
// The current period matters more than the history: a shop owner asks
// "what am I owed" far more often than "what did you pay me in June".
// ─────────────────────────────────────────────────────────────────────────
exports.getPayouts = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })

    const { currentPeriod } = require("../../services/merchantPayouts")

    let current = null
    try {
      current = await currentPeriod({ merchantType: "shop", merchantId: shop.id })
    } catch (e) { console.log("vendor current period:", e.message) }

    let payouts = []
    try {
      const r = await pool.query(
        `SELECT * FROM merchant_payouts
         WHERE merchant_type = 'shop' AND merchant_id = $1
         ORDER BY period_start DESC LIMIT 26`, [shop.id])
      payouts = r.rows
    } catch (e) { console.log("vendor payouts:", e.message) }

    const unpaid = payouts
      .filter(p => p.status !== "paid")
      .reduce((a, p) => a + Number(p.net_amount || 0), 0)

    res.json({
      success: true,
      current,
      payouts,
      unpaid: Math.round(unpaid * 100) / 100,
      bank: shop.bank_account_details || null,
    })
  } catch (e) {
    console.log("getPayouts error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// GET /api/vendor/payouts/:id — the orders behind one settlement.
exports.getPayoutDetail = async (req, res) => {
  try {
    const shop = await getMyShop(req.user.id)
    if (!shop) return res.status(403).json({ message: "No shop linked" })

    const p = await pool.query(
      `SELECT * FROM merchant_payouts
       WHERE id = $1 AND merchant_type = 'shop' AND merchant_id = $2`,
      [req.params.id, shop.id])
    if (p.rows.length === 0) return res.status(404).json({ message: "Not found" })

    const lines = await pool.query(
      `SELECT m.order_id, m.gross, m.commission, m.net,
              o.created_at, o.delivered_at
       FROM merchant_payout_orders m
       LEFT JOIN orders o ON o.id = m.order_id
       WHERE m.payout_id = $1 AND m.order_type = 'grocery'
       ORDER BY m.order_id`, [req.params.id])

    res.json({ success: true, payout: p.rows[0], orders: lines.rows })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}
