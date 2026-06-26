const pool = require("../../config/db")
const cloudinary = require("../../config/cloudinary")
const { setStatus } = require("../../services/medicine/statusHistory")

const isCOD = (m) => !m || /cod/i.test(m)

// GET /api/delivery/medicine-orders/packed
exports.packedOrders = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, ph.pharmacy_name, ph.address AS pharmacy_address, ph.phone AS pharmacy_phone
       FROM medicine_orders o LEFT JOIN pharmacies ph ON ph.id=o.pharmacy_id
       WHERE o.order_status='packed' AND o.delivery_boy_id IS NULL
       ORDER BY o.id DESC`)
    res.json({ success: true, orders: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/delivery/medicine-orders/my
exports.myOrders = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, ph.pharmacy_name, ph.address AS pharmacy_address, ph.phone AS pharmacy_phone
       FROM medicine_orders o LEFT JOIN pharmacies ph ON ph.id=o.pharmacy_id
       WHERE o.delivery_boy_id=$1 ORDER BY o.id DESC`, [req.user.id])
    res.json({ success: true, orders: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/delivery/medicine-orders/:id/accept — claim (atomic)
exports.accept = async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE medicine_orders SET delivery_boy_id=$1
       WHERE id=$2 AND order_status='packed' AND delivery_boy_id IS NULL RETURNING id`,
      [req.user.id, req.params.id])
    if (r.rows.length === 0) return res.status(400).json({ message: "Order already taken or not available" })
    await setStatus(req.params.id, "assigned_to_delivery_boy", "delivery", req.user.id)
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/delivery/medicine-orders/:id/pickup-confirm { orderNumber }
exports.pickupConfirm = async (req, res) => {
  try {
    const { id } = req.params
    const body = req.body || {}
    const orderNumber = body.orderNumber ?? body.order_number ?? req.query.orderNumber
    const ord = await pool.query(`SELECT * FROM medicine_orders WHERE id=$1 AND delivery_boy_id=$2`, [id, req.user.id])
    if (ord.rows.length === 0) return res.status(404).json({ message: "Order not assigned to you" })
    const o = ord.rows[0]
    if (!orderNumber || String(orderNumber).trim() !== String(o.order_number).trim())
      return res.status(400).json({ message: "Order number does not match" })
    await setStatus(id, "picked_up", "delivery", req.user.id)
    await setStatus(id, "out_for_delivery", "delivery", req.user.id)
    res.json({ success: true, order_status: "out_for_delivery" })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/delivery/medicine-orders/:id/out-for-delivery (idempotent)
exports.outForDelivery = async (req, res) => {
  try {
    const ord = await pool.query(`SELECT id FROM medicine_orders WHERE id=$1 AND delivery_boy_id=$2`, [req.params.id, req.user.id])
    if (ord.rows.length === 0) return res.status(404).json({ message: "Order not assigned to you" })
    await setStatus(req.params.id, "out_for_delivery", "delivery", req.user.id)
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/delivery/medicine-orders/:id/upload-delivery-photo (multipart)
exports.uploadDeliveryPhoto = async (req, res) => {
  try {
    const ord = await pool.query(`SELECT id FROM medicine_orders WHERE id=$1 AND delivery_boy_id=$2`, [req.params.id, req.user.id])
    if (ord.rows.length === 0) return res.status(404).json({ message: "Order not assigned to you" })
    const file = req.file || (req.files && req.files[0])
    if (!file) return res.status(400).json({ message: "No photo uploaded" })
    const b64 = file.buffer.toString("base64")
    const up = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${b64}`, { folder: "abhigro/medicine-delivery" })
    await pool.query(`UPDATE medicine_orders SET delivery_photo_url=$1 WHERE id=$2`, [up.secure_url, req.params.id])
    res.json({ success: true, delivery_photo_url: up.secure_url })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/delivery/medicine-orders/:id/cash-collected { amount? }
exports.cashCollected = async (req, res) => {
  try {
    const ord = await pool.query(`SELECT * FROM medicine_orders WHERE id=$1 AND delivery_boy_id=$2`, [req.params.id, req.user.id])
    if (ord.rows.length === 0) return res.status(404).json({ message: "Order not assigned to you" })
    const o = ord.rows[0]
    if (!isCOD(o.payment_method)) return res.status(400).json({ message: "Order is prepaid (online)." })
    const amount = (req.body || {}).amount ?? o.total_amount
    await pool.query(
      `UPDATE medicine_orders SET payment_status='collected', cod_collected_amount=$1 WHERE id=$2`,
      [amount, o.id])
    res.json({ success: true, payment_status: "collected" })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/delivery/medicine-orders/:id/delivered  (multipart optional photo + cashCollected)
exports.delivered = async (req, res) => {
  try {
    const ord = await pool.query(`SELECT * FROM medicine_orders WHERE id=$1 AND delivery_boy_id=$2`, [req.params.id, req.user.id])
    if (ord.rows.length === 0) return res.status(404).json({ message: "Order not assigned to you" })
    const o = ord.rows[0]

    // proof photo is OPTIONAL for medicine — upload if provided, otherwise skip
    let proof = o.delivery_photo_url
    const file = req.file || (req.files && req.files[0])
    if (file) {
      try {
        const b64 = file.buffer.toString("base64")
        const up = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${b64}`, { folder: "abhigro/medicine-delivery" })
        proof = up.secure_url
      } catch (e) { console.log("medicine proof upload skipped:", e.message) }
    }

    let payStatus = o.payment_status
    const body = req.body || {}
    const cash = body.cashCollected === true || body.cashCollected === "true"
    if (isCOD(o.payment_method)) {
      if (payStatus !== "collected" && !cash)
        return res.status(400).json({ message: "COD: collect cash and pass cashCollected=true (or call cash-collected first)" })
      payStatus = "collected"
    } else {
      payStatus = "paid"
    }

    const codAmount = payStatus === "collected"
      ? (o.cod_collected_amount ?? o.total_amount)
      : (o.cod_collected_amount ?? null)

    await pool.query(
      `UPDATE medicine_orders SET delivery_photo_url=$1, payment_status=$2, cod_collected_amount=$3 WHERE id=$4`,
      [proof, payStatus, codAmount, o.id])
    await setStatus(o.id, "delivered", "delivery", req.user.id)
    await setStatus(o.id, "completed", "delivery", req.user.id, "Delivery completed")
    res.json({ success: true, order_status: "completed", payment_status: payStatus, delivery_photo_url: proof })
  } catch (e) { res.status(500).json({ message: e.message }) }
}