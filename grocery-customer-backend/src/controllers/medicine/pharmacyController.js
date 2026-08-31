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

// ─────────────────────────────────────────────────────────────────────────
// GET /api/pharmacy/sales?days=7
// Aggregation over medicine_orders. The per-order commission columns are
// already populated, so they are summed rather than recalculated - the
// settlement must agree with the invoice the pharmacy already issued.
// ─────────────────────────────────────────────────────────────────────────
exports.getSales = async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7))

    const daily = await pool.query(
      `SELECT DATE(COALESCE(updated_at, created_at)) AS day,
              COUNT(*)::int                                            AS orders,
              COUNT(*) FILTER (WHERE order_status = 'delivered')::int   AS delivered,
              COUNT(*) FILTER (WHERE order_status LIKE '%reject%')::int AS rejected,
              COALESCE(SUM(total_medicine_amount)
                       FILTER (WHERE order_status = 'delivered'), 0)    AS goods,
              COALESCE(SUM(pharmacy_commission_amount)
                       FILTER (WHERE order_status = 'delivered'), 0)    AS commission,
              COALESCE(SUM(pharmacy_settlement_amount)
                       FILTER (WHERE order_status = 'delivered'), 0)    AS settlement
       FROM medicine_orders
       WHERE pharmacy_id = $1
         AND COALESCE(updated_at, created_at) >= NOW() - ($2 || ' days')::interval
       GROUP BY DATE(COALESCE(updated_at, created_at))
       ORDER BY day DESC`,
      [req.pharmacy.id, String(days)])

    const rows = daily.rows.map(r => ({
      day: r.day,
      orders: r.orders,
      delivered: r.delivered,
      rejected: r.rejected,
      sales: Number(r.goods || 0),
      commission: Number(r.commission || 0),
      payout: Number(r.settlement || 0),
    }))

    const tot = rows.reduce((a, r) => ({
      orders: a.orders + r.orders, delivered: a.delivered + r.delivered,
      rejected: a.rejected + r.rejected, sales: a.sales + r.sales,
      commission: a.commission + r.commission, payout: a.payout + r.payout,
    }), { orders: 0, delivered: 0, rejected: 0, sales: 0, commission: 0, payout: 0 })

    // Verification speed is the pharmacy's own performance metric, and the
    // one thing they can actually improve.
    let avgVerifyMin = null
    try {
      const v = await pool.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/60) AS m
         FROM medicine_orders
         WHERE pharmacy_id = $1
           AND order_status NOT IN ('medicine_order_placed','prescription_uploaded')
           AND created_at >= NOW() - ($2 || ' days')::interval`,
        [req.pharmacy.id, String(days)])
      if (v.rows[0]?.m != null) avgVerifyMin = Math.round(Number(v.rows[0].m))
    } catch (e) { /* optional */ }

    let top = []
    try {
      const t = await pool.query(
        `SELECT i.medicine_name AS name, SUM(i.quantity)::int AS qty,
                COALESCE(SUM(i.price * i.quantity), 0) AS value
         FROM medicine_order_items i
         JOIN medicine_orders o ON o.id = i.order_id
         WHERE o.pharmacy_id = $1 AND o.order_status = 'delivered'
           AND o.created_at >= NOW() - ($2 || ' days')::interval
         GROUP BY i.medicine_name ORDER BY qty DESC LIMIT 8`,
        [req.pharmacy.id, String(days)])
      top = t.rows.map(x => ({ name: x.name, qty: x.qty, value: Number(x.value || 0) }))
    } catch (e) { console.log("pharmacy top:", e.message) }

    const r2 = (n) => Math.round(n * 100) / 100
    res.json({
      success: true, days,
      totals: {
        ...tot, sales: r2(tot.sales), commission: r2(tot.commission), payout: r2(tot.payout),
        avg_basket: tot.delivered ? Math.round(tot.sales / tot.delivered) : 0,
        avg_verify_minutes: avgVerifyMin,
      },
      daily: rows, top_products: top,
    })
  } catch (e) {
    console.log("pharmacy getSales:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/pharmacy/payouts — same settlement engine as grocery shops.
// ─────────────────────────────────────────────────────────────────────────
exports.getPayouts = async (req, res) => {
  try {
    const { currentPeriod } = require("../../services/merchantPayouts")

    let current = null
    try {
      current = await currentPeriod({ merchantType: "pharmacy", merchantId: req.pharmacy.id })
    } catch (e) { console.log("pharmacy current period:", e.message) }

    let payouts = []
    try {
      const r = await pool.query(
        `SELECT * FROM merchant_payouts
         WHERE merchant_type = 'pharmacy' AND merchant_id = $1
         ORDER BY period_start DESC LIMIT 26`, [req.pharmacy.id])
      payouts = r.rows
    } catch (e) { console.log("pharmacy payouts:", e.message) }

    const unpaid = payouts.filter(p => p.status !== "paid")
      .reduce((a, p) => a + Number(p.net_amount || 0), 0)

    res.json({
      success: true, current, payouts,
      unpaid: Math.round(unpaid * 100) / 100,
    })
  } catch (e) {
    console.log("pharmacy getPayouts:", e.message)
    res.status(500).json({ message: e.message })
  }
}
