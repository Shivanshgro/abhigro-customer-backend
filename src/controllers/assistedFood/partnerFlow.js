const pool = require("../../config/db")

// Helper: load order and assert it belongs to this partner (for partner actions)
async function loadAssigned(orderId, partnerId) {
  const r = await pool.query(`SELECT * FROM assisted_food_orders WHERE id=$1`, [orderId])
  if (r.rows.length === 0) return { err: { code: 404, msg: "Order not found" } }
  const o = r.rows[0]
  if (partnerId && String(o.delivery_boy_id) !== String(partnerId))
    return { err: { code: 403, msg: "Not your assigned order" } }
  return { o }
}

// GET /api/assisted-food/available — open orders a partner can accept
exports.available = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.*, u.name AS customer_name
       FROM assisted_food_orders a LEFT JOIN users u ON u.id=a.user_id
       WHERE a.status='platform_paid' AND a.delivery_boy_id IS NULL
       ORDER BY a.id DESC`)
    res.json({ success: true, orders: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/assisted-food/:id/accept
exports.accept = async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE assisted_food_orders
       SET delivery_boy_id=$1, status='partner_assigned'
       WHERE id=$2 AND delivery_boy_id IS NULL AND status='platform_paid'
       RETURNING *`, [req.user.id, req.params.id])
    if (r.rows.length === 0) return res.status(409).json({ message: "Order already taken or not available" })
    res.json({ success: true, order: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/assisted-food/:id/reached
exports.reached = async (req, res) => {
  try {
    const { o, err } = await loadAssigned(req.params.id, req.user.id)
    if (err) return res.status(err.code).json({ message: err.msg })
    if (o.status !== "partner_assigned") return res.status(409).json({ message: `Cannot mark reached from ${o.status}` })
    const r = await pool.query(`UPDATE assisted_food_orders SET status='reached_pickup' WHERE id=$1 RETURNING *`, [o.id])
    res.json({ success: true, order: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/assisted-food/:id/confirm-price  { actual_food_amount, menu_photo? }
exports.confirmPrice = async (req, res) => {
  try {
    const { actual_food_amount, menu_photo } = req.body
    const amt = Number(actual_food_amount)
    if (!amt || amt <= 0) return res.status(400).json({ message: "Enter a valid food amount" })
    const { o, err } = await loadAssigned(req.params.id, req.user.id)
    if (err) return res.status(err.code).json({ message: err.msg })
    if (!["reached_pickup", "partner_assigned"].includes(o.status))
      return res.status(409).json({ message: `Cannot confirm price from ${o.status}` })
    const r = await pool.query(
      `UPDATE assisted_food_orders
       SET actual_food_amount=$1, price_confirmed_by_partner=true, price_confirmed_at=NOW(),
           vendor_qr_image=COALESCE($2, vendor_qr_image), status='price_confirmed'
       WHERE id=$3 RETURNING *`, [amt, menu_photo || null, o.id])
    res.json({ success: true, order: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/assisted-food/:id/picked-up   (GATE: vendor must be paid)
exports.pickedUp = async (req, res) => {
  try {
    const { pickup_proof } = req.body
    const { o, err } = await loadAssigned(req.params.id, req.user.id)
    if (err) return res.status(err.code).json({ message: err.msg })
    if (o.vendor_payment_status !== "paid")
      return res.status(409).json({ message: "Vendor must be paid before pickup" })
    const r = await pool.query(
      `UPDATE assisted_food_orders SET status='picked_up', pickup_proof_image=COALESCE($1,pickup_proof_image)
       WHERE id=$2 RETURNING *`, [pickup_proof || null, o.id])
    res.json({ success: true, order: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/assisted-food/:id/out-for-delivery
exports.outForDelivery = async (req, res) => {
  try {
    const { o, err } = await loadAssigned(req.params.id, req.user.id)
    if (err) return res.status(err.code).json({ message: err.msg })
    if (o.status !== "picked_up") return res.status(409).json({ message: `Cannot dispatch from ${o.status}` })
    const r = await pool.query(`UPDATE assisted_food_orders SET status='out_for_delivery' WHERE id=$1 RETURNING *`, [o.id])
    res.json({ success: true, order: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/assisted-food/:id/delivered  { delivery_proof? }
exports.delivered = async (req, res) => {
  try {
    const { delivery_proof } = req.body
    const { o, err } = await loadAssigned(req.params.id, req.user.id)
    if (err) return res.status(err.code).json({ message: err.msg })
    if (o.status !== "out_for_delivery") return res.status(409).json({ message: `Cannot deliver from ${o.status}` })
    const r = await pool.query(
      `UPDATE assisted_food_orders SET status='delivered', delivery_proof_image=COALESCE($1,delivery_proof_image)
       WHERE id=$2 RETURNING *`, [delivery_proof || null, o.id])
    res.json({ success: true, order: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
