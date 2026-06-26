const pool = require("../../config/db")
const cloudinary = require("../../config/cloudinary")
const { notifyUser, emitOrderUpdate } = require("../../services/notificationService")

const isCOD = (m) => !m || /cod/i.test(m)

// Shared SELECT for delivery-facing order views
const ORDER_FIELDS = `
  o.id, o.total_amount, o.pincode, o.status, o.payment_method, o.payment_status,
  o.packed_photo, o.delivery_photo, o.cash_collected, o.picked_up_at, o.delivered_at,
  s.shop_name, s.address AS shop_address, s.phone AS shop_phone,
  a.address_line AS customer_address, a.phone AS customer_phone`

// GET /api/delivery/available — packed orders not yet picked up by a boy
exports.availableOrders = async (req, res) => {
  try {
    const orders = await pool.query(
      `SELECT ${ORDER_FIELDS}
       FROM orders o
       LEFT JOIN shops s ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       WHERE o.status = 'Packed' AND o.delivery_boy_id IS NULL
       ORDER BY o.id DESC`
    )
    res.json({ success: true, orders: orders.rows })
  } catch (e) {
    console.log("availableOrders error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// GET /api/delivery/my — this delivery boy's active deliveries
exports.myDeliveries = async (req, res) => {
  try {
    const orders = await pool.query(
      `SELECT ${ORDER_FIELDS}
       FROM orders o
       LEFT JOIN shops s ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       WHERE o.delivery_boy_id = $1 AND o.status IN ('Out For Delivery','Packed')
       ORDER BY o.id DESC`,
      [req.user.id]
    )
    res.json({ success: true, orders: orders.rows })
  } catch (e) {
    console.log("myDeliveries error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// GET /api/delivery/history — completed deliveries
exports.history = async (req, res) => {
  try {
    const orders = await pool.query(
      `SELECT ${ORDER_FIELDS}
       FROM orders o
       LEFT JOIN shops s ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       WHERE o.delivery_boy_id = $1 AND o.status = 'Completed'
       ORDER BY o.delivered_at DESC NULLS LAST, o.id DESC`,
      [req.user.id]
    )
    res.json({ success: true, orders: orders.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/delivery/:id/pickup — claim a packed order (atomic; first wins)
exports.goToPickup = async (req, res) => {
  try {
    const { id } = req.params
    const result = await pool.query(
      `UPDATE orders SET delivery_boy_id = $1
       WHERE id = $2 AND status = 'Packed' AND delivery_boy_id IS NULL
       RETURNING id`,
      [req.user.id, id]
    )
    if (result.rows.length === 0)
      return res.status(400).json({ message: "Order already taken or not available" })
    emitOrderUpdate(id, { status: "Packed", delivery_boy_id: req.user.id })
    res.json({ success: true, message: "Assigned to you. Head to the shop." })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/delivery/:id/confirm-pickup — confirm pickup USING THE ORDER NUMBER
// Body: { orderNumber }  -> must match the order id. Sets status Out For Delivery.
exports.confirmPickup = async (req, res) => {
  try {
    const { id } = req.params
    const body = req.body || {}
    const orderNumber = body.orderNumber ?? body.order_number ?? body.code ?? req.query.orderNumber

    if (orderNumber === undefined || orderNumber === null || `${orderNumber}`.trim() === "")
      return res.status(400).json({ message: "Order number is required to confirm pickup" })

    if (`${orderNumber}`.trim() !== `${id}`.trim())
      return res.status(400).json({ message: "Order number does not match this order" })

    const result = await pool.query(
      `UPDATE orders
       SET status = 'Out For Delivery', picked_up_at = NOW()
       WHERE id = $1 AND delivery_boy_id = $2 AND status = 'Packed'
       RETURNING id`,
      [id, req.user.id]
    )
    if (result.rows.length === 0)
      return res.status(400).json({ message: "Order not assigned to you or not in Packed state" })

    emitOrderUpdate(id, { status: "Out For Delivery" })
    res.json({ success: true, message: "Pickup confirmed. Order is now Out For Delivery." })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/delivery/:id/picked — legacy/simple pickup (kept for compatibility)
// Accepts optional orderNumber; if provided it must match.
exports.markPickedUp = async (req, res) => {
  try {
    const { id } = req.params
    const body = req.body || {}
    const orderNumber = body.orderNumber ?? body.order_number
    if (orderNumber !== undefined && `${orderNumber}`.trim() !== `${id}`.trim())
      return res.status(400).json({ message: "Order number does not match this order" })

    const r = await pool.query(
      `UPDATE orders SET status = 'Out For Delivery', picked_up_at = COALESCE(picked_up_at, NOW())
       WHERE id = $1 AND delivery_boy_id = $2 AND status = 'Packed' RETURNING id`,
      [id, req.user.id]
    )
    if (r.rows.length === 0)
      return res.status(400).json({ message: "Order not assigned to you or not in Packed state" })
    emitOrderUpdate(id, { status: "Out For Delivery" })
    res.json({ success: true, message: "Out for delivery" })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/delivery/:id/proof — upload delivery proof photo (multipart, any field)
exports.uploadDeliveryProof = async (req, res) => {
  try {
    const { id } = req.params
    const file = req.file || (req.files && req.files[0])
    if (!file) return res.status(400).json({ message: "No photo uploaded" })

    const own = await pool.query(
      `SELECT id FROM orders WHERE id=$1 AND delivery_boy_id=$2`, [id, req.user.id])
    if (own.rows.length === 0)
      return res.status(404).json({ message: "Order not assigned to you" })

    const base64 = file.buffer.toString("base64")
    const dataURI = `data:${file.mimetype};base64,${base64}`
    const result = await cloudinary.uploader.upload(dataURI, { folder: "grocery/delivery" })

    await pool.query(`UPDATE orders SET delivery_photo=$1 WHERE id=$2`, [result.secure_url, id])
    res.json({ success: true, delivery_photo: result.secure_url })
  } catch (e) {
    console.log("uploadDeliveryProof error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// POST /api/delivery/:id/collect — COD: mark cash collected
exports.collectPayment = async (req, res) => {
  try {
    const { id } = req.params
    const ord = await pool.query(
      `SELECT payment_method, payment_status FROM orders WHERE id=$1 AND delivery_boy_id=$2`,
      [id, req.user.id])
    if (ord.rows.length === 0)
      return res.status(404).json({ message: "Order not assigned to you" })

    if (!isCOD(ord.rows[0].payment_method))
      return res.status(400).json({ message: "Order is prepaid (online). Nothing to collect.", payment_status: ord.rows[0].payment_status })

    await pool.query(
      `UPDATE orders SET payment_status='Collected', cash_collected=true WHERE id=$1`, [id])
    emitOrderUpdate(id, { payment_status: "Collected" })
    res.json({ success: true, payment_status: "Collected" })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/delivery/:id/delivered — complete the delivery.
// All-in-one: optional proof photo (multipart) + optional cashCollected flag.
//  - Requires a delivery proof photo (either uploaded here, or already via /proof).
//  - COD: cash must be collected (cashCollected flag here, or already via /collect).
//  - Online: payment stays "Paid".
//  - Sets status = 'Completed'.
exports.markDelivered = async (req, res) => {
  try {
    const { id } = req.params
    const ord = await pool.query(
      `SELECT payment_method, payment_status, delivery_photo, status
       FROM orders WHERE id=$1 AND delivery_boy_id=$2`,
      [id, req.user.id])
    if (ord.rows.length === 0)
      return res.status(404).json({ message: "Order not assigned to you" })
    const o = ord.rows[0]

    if (o.status !== "Out For Delivery" && o.status !== "Completed")
      return res.status(400).json({ message: "Confirm pickup first — order must be Out For Delivery." })

    // 1) Delivery proof photo (inline upload optional if already provided via /proof)
    let proofUrl = o.delivery_photo
    const file = req.file || (req.files && req.files[0])
    if (file) {
      const base64 = file.buffer.toString("base64")
      const dataURI = `data:${file.mimetype};base64,${base64}`
      const up = await cloudinary.uploader.upload(dataURI, { folder: "grocery/delivery" })
      proofUrl = up.secure_url
    }
    if (!proofUrl)
      return res.status(400).json({ message: "Delivery proof photo is required to complete the order" })

    // 2) Payment resolution
    let paymentStatus = o.payment_status
    const body = req.body || {}
    const cashCollected = body.cashCollected === true || body.cashCollected === "true" || body.collected === "true"
    if (isCOD(o.payment_method)) {
      if (paymentStatus !== "Collected" && !cashCollected)
        return res.status(400).json({ message: "COD order: collect cash and pass cashCollected=true (or call /collect first)." })
      paymentStatus = "Collected"
    } else {
      paymentStatus = "Paid"
    }

    // 3) Complete
    await pool.query(
      `UPDATE orders
       SET status='Completed', delivery_photo=$1, payment_status=$2,
           cash_collected = CASE WHEN $2='Collected' THEN true ELSE cash_collected END,
           delivered_at=NOW()
       WHERE id=$3 AND delivery_boy_id=$4`,
      [proofUrl, paymentStatus, id, req.user.id]
    )

    // ── Referral bonus: pay referrer on this customer's FIRST delivered order ──
    try {
      const { walletTxn } = require("../../utils/wallet")
      const { getDeliverySettings } = require("../../utils/settings")
      const cust = await pool.query(`SELECT user_id FROM orders WHERE id=$1`, [id])
      const custId = cust.rows[0]?.user_id
      if (custId) {
        const meRow = await pool.query(`SELECT referred_by FROM users WHERE id=$1`, [custId])
        const referrerId = meRow.rows[0]?.referred_by
        if (referrerId) {
          // only if we haven't already paid a referral bonus for this referee
          const paid = await pool.query(
            `SELECT 1 FROM wallet_transactions WHERE type='referral_bonus' AND reference=$1 LIMIT 1`,
            [`referee:${custId}`])
          if (paid.rows.length === 0) {
            const st = await getDeliverySettings()
            const refBonus = Number(st.referral_referrer_bonus || 0)
            const youBonus = Number(st.referral_referee_bonus || 0)
            if (refBonus > 0) await walletTxn(null, referrerId, refBonus, "referral_bonus", `referee:${custId}`)
            if (youBonus > 0) await walletTxn(null, custId, youBonus, "referral_bonus", `referrer:${referrerId}`)
          }
        }
      }
    } catch (refErr) { console.log("referral payout skipped:", refErr.message) }

    // Notify the customer
    try {
      const c = await pool.query(`SELECT user_id FROM orders WHERE id=$1`, [id])
      if (c.rows[0])
        await notifyUser(c.rows[0].user_id, "Order delivered",
          `Your order #${id} has been delivered. ${paymentStatus === "Collected" ? "Cash payment collected." : "Payment: Paid."}`)
    } catch (e) { console.log("notify customer error:", e.message) }

    emitOrderUpdate(id, { status: "Completed", payment_status: paymentStatus, delivery_photo: proofUrl })
    res.json({
      success: true,
      message: "Delivered. Order completed!",
      status: "Completed",
      payment_status: paymentStatus,
      delivery_photo: proofUrl,
    })
  } catch (e) {
    console.log("markDelivered error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
