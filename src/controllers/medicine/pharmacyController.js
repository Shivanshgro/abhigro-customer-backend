const pool = require("../../config/db")
const cloudinary = require("../../config/cloudinary")
const { setStatus } = require("../../services/medicine/statusHistory")
const { notifyDeliveryBoys } = require("../../services/notificationService")

async function ownOrder(req, id) {
  const r = await pool.query(`SELECT * FROM medicine_orders WHERE id=$1 AND pharmacy_id=$2`, [id, req.pharmacy.id])
  return r.rows[0] || null
}

// GET /api/pharmacy/orders
exports.listOrders = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM medicine_orders WHERE pharmacy_id=$1 ORDER BY id DESC`, [req.pharmacy.id])
    res.json({ success: true, orders: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/pharmacy/orders/:id
exports.getOrder = async (req, res) => {
  try {
    const o = await ownOrder(req, req.params.id)
    if (!o) return res.status(404).json({ message: "Order not found for this pharmacy" })
    const items = await pool.query(`SELECT * FROM medicine_order_items WHERE order_id=$1`, [o.id])
    res.json({ success: true, order: { ...o, items: items.rows } })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/pharmacy/orders/:id/approve-prescription
exports.approvePrescription = async (req, res) => {
  try {
    const o = await ownOrder(req, req.params.id)
    if (!o) return res.status(404).json({ message: "Order not found" })
    await pool.query(`UPDATE medicine_orders SET prescription_status='approved' WHERE id=$1`, [o.id])
    await setStatus(o.id, "prescription_approved", "pharmacy", req.user.id)
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/pharmacy/orders/:id/reject-prescription { reason }
exports.rejectPrescription = async (req, res) => {
  try {
    const o = await ownOrder(req, req.params.id)
    if (!o) return res.status(404).json({ message: "Order not found" })
    const reason = (req.body || {}).reason || "Prescription rejected"
    await pool.query(
      `UPDATE medicine_orders SET prescription_status='rejected', prescription_rejection_reason=$1, order_status='prescription_rejected' WHERE id=$2`,
      [reason, o.id])
    await setStatus(o.id, "prescription_rejected", "pharmacy", req.user.id, reason)
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/pharmacy/orders/:id/request-clear-prescription
exports.requestClearPrescription = async (req, res) => {
  try {
    const o = await ownOrder(req, req.params.id)
    if (!o) return res.status(404).json({ message: "Order not found" })
    await pool.query(`UPDATE medicine_orders SET prescription_status='clear_required' WHERE id=$1`, [o.id])
    await setStatus(o.id, "clear_prescription_required", "pharmacy", req.user.id, (req.body || {}).remarks || null)
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/pharmacy/orders/:id/medicine-not-available
exports.medicineNotAvailable = async (req, res) => {
  try {
    const o = await ownOrder(req, req.params.id)
    if (!o) return res.status(404).json({ message: "Order not found" })
    await setStatus(o.id, "medicine_not_available", "pharmacy", req.user.id, (req.body || {}).remarks || null)
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/pharmacy/orders/:id/approve-order
exports.approveOrder = async (req, res) => {
  try {
    const o = await ownOrder(req, req.params.id)
    if (!o) return res.status(404).json({ message: "Order not found" })
    if (o.requires_prescription && o.prescription_status !== "approved")
      return res.status(400).json({ message: "Approve the prescription first" })
    await setStatus(o.id, "pharmacy_approved", "pharmacy", req.user.id)
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/pharmacy/orders/:id/upload-packed-photo (multipart)
exports.uploadPackedPhoto = async (req, res) => {
  try {
    const o = await ownOrder(req, req.params.id)
    if (!o) return res.status(404).json({ message: "Order not found" })
    const file = req.file || (req.files && req.files[0])
    if (!file) return res.status(400).json({ message: "No photo uploaded" })
    const b64 = file.buffer.toString("base64")
    const up = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${b64}`, { folder: "abhigro/medicine-packed" })
    await pool.query(`UPDATE medicine_orders SET packed_photo_url=$1 WHERE id=$2`, [up.secure_url, o.id])
    res.json({ success: true, packed_photo_url: up.secure_url })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/pharmacy/orders/:id/invoice { invoice_url?, items? }
exports.saveInvoice = async (req, res) => {
  try {
    const o = await ownOrder(req, req.params.id)
    if (!o) return res.status(404).json({ message: "Order not found" })
    const b = req.body || {}
    if (b.invoice_url) await pool.query(`UPDATE medicine_orders SET pharmacy_invoice_url=$1 WHERE id=$2`, [b.invoice_url, o.id])
    // Optionally update batch/expiry per item from pharmacy's billing
    if (Array.isArray(b.items)) {
      for (const it of b.items) {
        await pool.query(
          `UPDATE medicine_order_items SET batch_number=COALESCE($1,batch_number), expiry_date=COALESCE($2,expiry_date) WHERE id=$3 AND order_id=$4`,
          [it.batch_number || null, it.expiry_date || null, it.id, o.id])
      }
    }
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/pharmacy/orders/:id/packed
exports.markPacked = async (req, res) => {
  try {
    const o = await ownOrder(req, req.params.id)
    if (!o) return res.status(404).json({ message: "Order not found" })
    if (o.requires_prescription && o.prescription_status !== "approved")
      return res.status(400).json({ message: "Approve the prescription first" })
    await setStatus(o.id, "packed", "pharmacy", req.user.id, "Packed and ready for pickup")
    // notify delivery boys
    try {
      await notifyDeliveryBoys(
        { id: o.id, pincode: o.customer_pincode, total_amount: o.total_amount },
        "Medicine order ready for pickup",
        `Medicine order ${o.order_number} is packed at ${req.pharmacy.pharmacy_name}.`)
    } catch (e) { console.log("notify err:", e.message) }
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
