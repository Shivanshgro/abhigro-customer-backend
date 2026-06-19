const pool = require("../../config/db")
const cloudinary = require("../../config/cloudinary")
const { computeTotals } = require("../../services/medicine/pricing")
const { assignPharmacy, decrementStock } = require("../../services/medicine/pharmacyAssign")
const { setStatus } = require("../../services/medicine/statusHistory")

function genOrderNumber() {
  return "MED" + Date.now().toString().slice(-9) + Math.floor(Math.random() * 90 + 10)
}
const isCOD = (m) => !m || /cod/i.test(m)

async function uploadToCloud(file, folder) {
  const b64 = file.buffer.toString("base64")
  const r = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${b64}`, { folder })
  return r.secure_url
}

// GET /api/medicine/products?search=&category=&type=
exports.listProducts = async (req, res) => {
  try {
    const { search, category, type } = req.query
    const params = []
    let where = "WHERE mp.is_active=true"
    if (search) { params.push(`%${search}%`); where += ` AND mp.medicine_name ILIKE $${params.length}` }
    if (category) { params.push(category); where += ` AND mp.category=$${params.length}` }
    if (type) { params.push(type); where += ` AND mp.product_type=$${params.length}` }
    const r = await pool.query(
      `SELECT mp.*, ph.pharmacy_name FROM medicine_products mp
       LEFT JOIN pharmacies ph ON ph.id=mp.pharmacy_id
       ${where} ORDER BY mp.id DESC LIMIT 200`, params)
    res.json({ success: true, products: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/medicine/products/:id
exports.getProduct = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT mp.*, ph.pharmacy_name FROM medicine_products mp
       LEFT JOIN pharmacies ph ON ph.id=mp.pharmacy_id WHERE mp.id=$1`, [req.params.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Product not found" })
    res.json({ success: true, product: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/medicine/prescription/upload  (multipart, before placing order)
exports.uploadPrescriptionFile = async (req, res) => {
  try {
    const file = req.file || (req.files && req.files[0])
    if (!file) return res.status(400).json({ message: "No prescription file uploaded" })
    const url = await uploadToCloud(file, "abhigro/prescriptions")
    res.json({ success: true, prescription_url: url })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/medicine/orders
// body: { items:[{medicine_product_id, quantity}], address, pincode, phone,
//         latitude, longitude, paymentMethod, prescription_url?, urgent? }
exports.createOrder = async (req, res) => {
  try {
    const b = req.body || {}
    const items = Array.isArray(b.items) ? b.items : []
    if (items.length === 0) return res.status(400).json({ message: "No items in order" })

    // Load product rows, validate, build line items
    let requiresRx = false
    const lineItems = []
    for (const it of items) {
      const pr = await pool.query(
        `SELECT * FROM medicine_products WHERE id=$1 AND is_active=true`, [it.medicine_product_id])
      if (pr.rows.length === 0) return res.status(400).json({ message: `Product ${it.medicine_product_id} unavailable` })
      const p = pr.rows[0]
      const qty = Math.max(1, parseInt(it.quantity) || 1)
      // never above MRP
      const sell = Math.min(Number(p.selling_price), Number(p.mrp))
      if (p.requires_prescription) requiresRx = true
      lineItems.push({
        medicine_product_id: p.id, medicine_name: p.medicine_name, product_type: p.product_type,
        quantity: qty, mrp: Number(p.mrp), selling_price: sell, total_price: sell * qty,
        batch_number: p.batch_number, expiry_date: p.expiry_date, manufacturer_name: p.manufacturer_name,
      })
    }

    // Prescription enforcement
    const prescription_url = b.prescription_url || null
    if (requiresRx && !prescription_url) {
      return res.status(400).json({ message: "Prescription required. Please upload a valid prescription before placing this order." })
    }

    const totals = computeTotals(lineItems, { distanceKm: b.distanceKm || 0, urgent: !!b.urgent })
    const payMethod = isCOD(b.paymentMethod) ? "cod" : "online"
    const payStatus = payMethod === "cod" ? "pending" : "pending" // online becomes 'paid' after verify
    const orderNumber = genOrderNumber()

    // Assign a licensed pharmacy with stock
    const assign = await assignPharmacy(b.pincode, lineItems)

    const ins = await pool.query(
      `INSERT INTO medicine_orders(
         order_number, customer_id, pharmacy_id, customer_name, customer_phone,
         customer_address, customer_pincode, latitude, longitude,
         total_medicine_amount, delivery_fee, platform_fee, total_amount,
         pharmacy_commission_percent, pharmacy_commission_amount, pharmacy_settlement_amount,
         payment_method, payment_status, order_status, prescription_url, prescription_status,
         requires_prescription)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [orderNumber, req.user.id, assign.pharmacyId, b.customerName || null, b.phone || null,
       b.address || null, b.pincode || null, b.latitude || null, b.longitude || null,
       totals.total_medicine_amount, totals.delivery_fee, totals.platform_fee, totals.total_amount,
       totals.pharmacy_commission_percent, totals.pharmacy_commission_amount, totals.pharmacy_settlement_amount,
       payMethod, payStatus,
       assign.pharmacyId ? "assigned_to_pharmacy" : "medicine_order_placed",
       prescription_url, prescription_url ? "uploaded" : null,
       requiresRx]
    )
    const order = ins.rows[0]

    for (const li of lineItems) {
      await pool.query(
        `INSERT INTO medicine_order_items(order_id, medicine_product_id, medicine_name, quantity, mrp, selling_price, total_price, batch_number, expiry_date, manufacturer_name)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id, li.medicine_product_id, li.medicine_name, li.quantity, li.mrp, li.selling_price, li.total_price, li.batch_number, li.expiry_date, li.manufacturer_name])
    }

    await setStatus(order.id, "medicine_order_placed", "customer", req.user.id, "Order placed")
    if (prescription_url) await setStatus(order.id, "prescription_uploaded", "customer", req.user.id)
    if (assign.pharmacyId) {
      await decrementStock(assign.pharmacyId, lineItems)
      await setStatus(order.id, "assigned_to_pharmacy", "system", null, `Assigned (${assign.basis})`)
      if (requiresRx) await setStatus(order.id, "prescription_under_review", "system", null)
    }

    res.json({ success: true, order, assigned: !!assign.pharmacyId })
  } catch (e) {
    console.log("medicine createOrder error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// POST /api/medicine/orders/:id/upload-prescription (multipart) — re-upload / clearer
exports.uploadPrescription = async (req, res) => {
  try {
    const { id } = req.params
    const file = req.file || (req.files && req.files[0])
    if (!file) return res.status(400).json({ message: "No prescription file uploaded" })
    const own = await pool.query(`SELECT id FROM medicine_orders WHERE id=$1 AND customer_id=$2`, [id, req.user.id])
    if (own.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const url = await uploadToCloud(file, "abhigro/prescriptions")
    await pool.query(
      `UPDATE medicine_orders SET prescription_url=$1, prescription_status='uploaded', prescription_rejection_reason=NULL WHERE id=$2`,
      [url, id])
    await setStatus(id, "prescription_uploaded", "customer", req.user.id, "Prescription uploaded")
    res.json({ success: true, prescription_url: url })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/medicine/orders/my-orders
exports.myOrders = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, ph.pharmacy_name FROM medicine_orders o
       LEFT JOIN pharmacies ph ON ph.id=o.pharmacy_id
       WHERE o.customer_id=$1 ORDER BY o.id DESC`, [req.user.id])
    res.json({ success: true, orders: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/medicine/orders/:id (own)
exports.getOrder = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, ph.pharmacy_name, ph.address AS pharmacy_address, ph.phone AS pharmacy_phone
       FROM medicine_orders o LEFT JOIN pharmacies ph ON ph.id=o.pharmacy_id
       WHERE o.id=$1 AND o.customer_id=$2`, [req.params.id, req.user.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const items = await pool.query(`SELECT * FROM medicine_order_items WHERE order_id=$1`, [req.params.id])
    res.json({ success: true, order: { ...r.rows[0], items: items.rows } })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/medicine/orders/:id/invoice — pharmacy invoice (medicine items only)
exports.invoice = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, ph.pharmacy_name, ph.address AS pharmacy_address, ph.drug_license_number, ph.gst_number, ph.pharmacist_name
       FROM medicine_orders o LEFT JOIN pharmacies ph ON ph.id=o.pharmacy_id
       WHERE o.id=$1 AND o.customer_id=$2`, [req.params.id, req.user.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const o = r.rows[0]
    const items = await pool.query(`SELECT * FROM medicine_order_items WHERE order_id=$1`, [req.params.id])
    res.json({
      success: true,
      invoice: {
        type: "Pharmacy Invoice", invoice_number: `INV-${o.order_number}`,
        pharmacy: { name: o.pharmacy_name, address: o.pharmacy_address, drug_license_number: o.drug_license_number, gstin: o.gst_number, pharmacist: o.pharmacist_name },
        items: items.rows,
        total_medicine_amount: o.total_medicine_amount,
        pharmacy_invoice_url: o.pharmacy_invoice_url || null,
      },
    })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/medicine/orders/:id/service-receipt — AbhiGro receipt (fees only)
exports.serviceReceipt = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM medicine_orders WHERE id=$1 AND customer_id=$2`, [req.params.id, req.user.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const o = r.rows[0]
    res.json({
      success: true,
      receipt: {
        type: "AbhiGro Service Receipt", receipt_number: `SR-${o.order_number}`,
        delivery_fee: o.delivery_fee, platform_fee: o.platform_fee,
        total_service_charge: Number(o.delivery_fee) + Number(o.platform_fee),
        receipt_url: o.abhigro_service_receipt_url || null,
      },
    })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
