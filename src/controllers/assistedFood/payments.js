const pool = require("../../config/db")
const crypto = require("crypto")

let razorpay = null
try {
  const Razorpay = require("razorpay")
  const KEY = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY
  const SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET
  if (KEY && SECRET) razorpay = new Razorpay({ key_id: KEY, key_secret: SECRET })
} catch (e) { console.log("razorpay init (assisted):", e.message) }

// POST /api/assisted-food/:id/customer-link
// Generate a Razorpay order/payment for the CONFIRMED food amount. Customer pays AbhiGro.
exports.customerLink = async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM assisted_food_orders WHERE id=$1`, [req.params.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const o = r.rows[0]
    if (!o.price_confirmed_by_partner || !o.actual_food_amount)
      return res.status(409).json({ message: "Price not confirmed yet" })
    if (!razorpay) {
      // No keys yet — mark pending so the flow is testable without Razorpay
      await pool.query(`UPDATE assisted_food_orders SET status='food_payment_pending', customer_food_payment_status='pending' WHERE id=$1`, [o.id])
      return res.json({ success: true, message: "Razorpay keys missing — payment link not generated", amount: Number(o.actual_food_amount) })
    }
    const rzpOrder = await razorpay.orders.create({
      amount: Math.round(Number(o.actual_food_amount) * 100),
      currency: "INR",
      receipt: `assisted_${o.id}_${Date.now()}`,
    })
    await pool.query(
      `UPDATE assisted_food_orders
       SET status='food_payment_pending', customer_food_payment_status='pending', customer_payment_link_id=$1
       WHERE id=$2`, [rzpOrder.id, o.id])
    res.json({ success: true, razorpay_order: rzpOrder, amount: Number(o.actual_food_amount),
      key: process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY })
  } catch (e) { console.log("customerLink error:", e.message); res.status(500).json({ message: e.message }) }
}

// POST /api/assisted-food/:id/verify-food-payment  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
exports.verifyFoodPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
    const r = await pool.query(`SELECT * FROM assisted_food_orders WHERE id=$1`, [req.params.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Order not found" })

    const SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET
    // Signature verification is MANDATORY.
    if (!SECRET) return res.status(500).json({ message: "Payment secret not configured" })
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return res.status(400).json({ message: "Missing payment verification fields" })
    const expected = crypto.createHmac("sha256", SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex")
    if (expected !== razorpay_signature) return res.status(400).json({ message: "Payment verification failed" })
    const upd = await pool.query(
      `UPDATE assisted_food_orders
       SET customer_food_payment_status='paid', customer_payment_id=$1, status='food_payment_paid'
       WHERE id=$2 RETURNING *`, [razorpay_payment_id || null, req.params.id])
    res.json({ success: true, order: upd.rows[0] })
  } catch (e) { console.log("verifyFoodPayment error:", e.message); res.status(500).json({ message: e.message }) }
}

// Parse a UPI id (pa=...) out of a scanned QR string like upi://pay?pa=name@bank&pn=...
function parseUpi(qr) {
  if (!qr) return null
  try {
    const m = String(qr).match(/[?&]pa=([^&]+)/i)
    if (m) return decodeURIComponent(m[1])
    if (/^[\w.\-]+@[\w.\-]+$/.test(qr.trim())) return qr.trim() // raw UPI id
  } catch (e) {}
  return null
}

// POST /api/assisted-food/:id/pay-vendor  { qr_string, qr_image? }
// HARD GATE: customer food payment must be 'paid'. Then RazorpayX payout to vendor UPI.
exports.payVendor = async (req, res) => {
  try {
    const { qr_string, qr_image } = req.body
    const r = await pool.query(`SELECT * FROM assisted_food_orders WHERE id=$1`, [req.params.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const o = r.rows[0]
    if (String(o.delivery_boy_id) !== String(req.user.id))
      return res.status(403).json({ message: "Not your assigned order" })

    // ---- HARD MONEY GATE ----
    if (o.customer_food_payment_status !== "paid")
      return res.status(409).json({ message: "Customer food payment not completed — cannot pay vendor" })
    if (o.vendor_payment_status === "paid")
      return res.status(409).json({ message: "Vendor already paid" })

    const upi = parseUpi(qr_string) || o.vendor_upi_id
    if (!upi) return res.status(400).json({ message: "Could not read a valid UPI ID from the QR" })

    await pool.query(`UPDATE assisted_food_orders SET vendor_upi_id=$1, vendor_qr_image=COALESCE($2,vendor_qr_image), vendor_payment_status='processing', status='vendor_payment_pending' WHERE id=$3`,
      [upi, qr_image || null, o.id])

    // ---- RazorpayX payout ----
    // Requires env: RAZORPAYX_KEY, RAZORPAYX_SECRET, RAZORPAYX_ACCOUNT (your RazorpayX account number)
    const RX_KEY = process.env.RAZORPAYX_KEY, RX_SECRET = process.env.RAZORPAYX_SECRET
    const RX_ACCOUNT = process.env.RAZORPAYX_ACCOUNT
    if (!RX_KEY || !RX_SECRET || !RX_ACCOUNT) {
      // Keys not set yet — leave as pending for ADMIN MANUAL payout (fallback path).
      return res.json({ success: true, manual: true,
        message: "RazorpayX not configured — order set to vendor_payment_pending for admin manual payout",
        vendor_upi_id: upi })
    }
    try {
      const fetch = global.fetch || require("node-fetch")
      const auth = Buffer.from(`${RX_KEY}:${RX_SECRET}`).toString("base64")
      // Create payout to UPI (fund_account via VPA). See RazorpayX Payouts API.
      const payoutRes = await fetch("https://api.razorpay.com/v1/payouts", {
        method: "POST",
        headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          account_number: RX_ACCOUNT,
          amount: Math.round(Number(o.actual_food_amount) * 100),
          currency: "INR",
          mode: "UPI",
          purpose: "payout",
          fund_account: { account_type: "vpa", vpa: { address: upi } },
          queue_if_low_balance: true,
          reference_id: `assisted_${o.id}`,
          narration: `AbhiGro food ${o.id}`,
        }),
      })
      const payout = await payoutRes.json()
      if (!payoutRes.ok || payout.error) {
        await pool.query(`UPDATE assisted_food_orders SET vendor_payment_status='failed' WHERE id=$1`, [o.id])
        return res.status(502).json({ success: false, message: payout.error?.description || "Payout failed", payout })
      }
      await pool.query(
        `UPDATE assisted_food_orders
         SET vendor_payment_status='paid', vendor_payment_reference_id=$1, vendor_paid_at=NOW(), status='vendor_paid'
         WHERE id=$2`, [payout.id || null, o.id])
      res.json({ success: true, payout })
    } catch (payErr) {
      await pool.query(`UPDATE assisted_food_orders SET vendor_payment_status='failed' WHERE id=$1`, [o.id])
      res.status(502).json({ success: false, message: "Payout request error: " + payErr.message })
    }
  } catch (e) { console.log("payVendor error:", e.message); res.status(500).json({ message: e.message }) }
}

// POST /api/assisted-food/:id/vendor-proof  { proof_image }
exports.vendorProof = async (req, res) => {
  try {
    const { proof_image } = req.body
    const r = await pool.query(
      `UPDATE assisted_food_orders SET vendor_payment_proof_image=$1 WHERE id=$2 AND delivery_boy_id=$3 RETURNING *`,
      [proof_image || null, req.params.id, req.user.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Order not found / not yours" })
    res.json({ success: true, order: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
