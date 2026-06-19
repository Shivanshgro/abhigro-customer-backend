const pool = require("../../config/db")

// GET /api/admin/medicine/orders?status=
exports.listOrders = async (req, res) => {
  try {
    const { status } = req.query
    const params = []
    let where = ""
    if (status) { params.push(status); where = `WHERE o.order_status=$1` }
    const r = await pool.query(
      `SELECT o.*, ph.pharmacy_name FROM medicine_orders o
       LEFT JOIN pharmacies ph ON ph.id=o.pharmacy_id
       ${where} ORDER BY o.id DESC LIMIT 300`, params)
    res.json({ success: true, orders: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/admin/medicine/orders/:id (admin can view, incl. prescription)
exports.getOrder = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT o.*, ph.pharmacy_name, ph.drug_license_number FROM medicine_orders o
       LEFT JOIN pharmacies ph ON ph.id=o.pharmacy_id WHERE o.id=$1`, [req.params.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const items = await pool.query(`SELECT * FROM medicine_order_items WHERE order_id=$1`, [req.params.id])
    const history = await pool.query(`SELECT * FROM medicine_order_status_history WHERE order_id=$1 ORDER BY id`, [req.params.id])
    res.json({ success: true, order: { ...r.rows[0], items: items.rows, history: history.rows } })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/admin/pharmacies
exports.listPharmacies = async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM pharmacies ORDER BY id DESC`)
    res.json({ success: true, pharmacies: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/admin/pharmacies — register a licensed pharmacy
exports.createPharmacy = async (req, res) => {
  try {
    const b = req.body || {}
    const r = await pool.query(
      `INSERT INTO pharmacies(owner_user_id, pharmacy_name, owner_name, phone, email, address, pincode,
         latitude, longitude, drug_license_number, license_expiry_date, gst_number,
         pharmacist_name, pharmacist_registration_number, is_active, is_online)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [b.owner_user_id || null, b.pharmacy_name, b.owner_name || null, b.phone || null, b.email || null,
       b.address || null, b.pincode || null, b.latitude || null, b.longitude || null,
       b.drug_license_number || null, b.license_expiry_date || null, b.gst_number || null,
       b.pharmacist_name || null, b.pharmacist_registration_number || null,
       b.is_active ?? false, b.is_online ?? false])
    res.json({ success: true, pharmacy: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/admin/pharmacies/:id/approve
exports.approvePharmacy = async (req, res) => {
  try {
    await pool.query(`UPDATE pharmacies SET is_active=true, updated_at=NOW() WHERE id=$1`, [req.params.id])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/admin/pharmacies/:id/disable
exports.disablePharmacy = async (req, res) => {
  try {
    await pool.query(`UPDATE pharmacies SET is_active=false, is_online=false, updated_at=NOW() WHERE id=$1`, [req.params.id])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/admin/medicine/settlements
exports.listSettlements = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*, ph.pharmacy_name FROM pharmacy_settlements s
       LEFT JOIN pharmacies ph ON ph.id=s.pharmacy_id ORDER BY s.id DESC`)
    res.json({ success: true, settlements: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/admin/medicine/settlements/generate { pharmacy_id, start, end, subscription_fee?, gst_percent? }
exports.generateSettlement = async (req, res) => {
  try {
    const b = req.body || {}
    if (!b.pharmacy_id || !b.start || !b.end)
      return res.status(400).json({ message: "pharmacy_id, start, end required" })

    const agg = await pool.query(
      `SELECT COUNT(*) AS orders,
              COALESCE(SUM(total_medicine_amount),0) AS medicine_value,
              COALESCE(SUM(pharmacy_commission_amount),0) AS commission,
              COALESCE(SUM(pharmacy_settlement_amount),0) AS payable_pharmacy
       FROM medicine_orders
       WHERE pharmacy_id=$1 AND order_status='completed'
         AND created_at::date BETWEEN $2 AND $3`,
      [b.pharmacy_id, b.start, b.end])
    const a = agg.rows[0]
    const subscription = Number(b.subscription_fee || 0)
    const gstPct = Number(b.gst_percent || 0)
    const commission = Number(a.commission)
    const gst = Math.round((commission + subscription) * gstPct) / 100
    const payableToAbhigro = Math.round((commission + subscription + gst) * 100) / 100

    const r = await pool.query(
      `INSERT INTO pharmacy_settlements(pharmacy_id, settlement_period_start, settlement_period_end,
         total_orders, total_medicine_value, total_commission, subscription_fee, gst_amount,
         total_payable_to_abhigro, total_payable_to_pharmacy, settlement_status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING *`,
      [b.pharmacy_id, b.start, b.end, a.orders, a.medicine_value, commission, subscription, gst,
       payableToAbhigro, a.payable_pharmacy])
    res.json({ success: true, settlement: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/admin/medicine/reports
exports.reports = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE order_status='completed') AS completed_orders,
         COUNT(*) AS total_orders,
         COALESCE(SUM(total_medicine_amount) FILTER (WHERE order_status='completed'),0) AS medicine_value,
         COALESCE(SUM(pharmacy_commission_amount) FILTER (WHERE order_status='completed'),0) AS commission_earned,
         COALESCE(SUM(delivery_fee) FILTER (WHERE order_status='completed'),0) AS delivery_fees,
         COALESCE(SUM(platform_fee) FILTER (WHERE order_status='completed'),0) AS platform_fees
       FROM medicine_orders`)
    const x = r.rows[0]
    const abhigroEarning = Number(x.commission_earned) + Number(x.delivery_fees) + Number(x.platform_fees)
    res.json({ success: true, report: { ...x, abhigro_total_earning: Math.round(abhigroEarning * 100) / 100 } })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
