const crypto = require("crypto")
const pool = require("../../config/db")

// POST /api/webhook/razorpay
// Razorpay calls this server-to-server. We verify the webhook signature using the
// RAZORPAY_WEBHOOK_SECRET (set in Razorpay dashboard + Azure env), then mark the
// matching order paid. This is the AUTHORITATIVE confirmation — independent of the
// client /verify call, so a dropped client callback never loses a paid order.
//
// IMPORTANT: this route must receive the RAW body for signature verification.
// In app/server.js mount it with express.raw, e.g.:
//   app.use("/api/webhook/razorpay", express.raw({ type: "*/*" }), razorpayWebhookRoute)
const razorpayWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET
    if (!secret) { console.error("RAZORPAY_WEBHOOK_SECRET not set"); return res.status(500).json({ message: "Webhook not configured" }) }

    const signature = req.headers["x-razorpay-signature"]
    // req.body is a Buffer when express.raw is used
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body))
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex")
    if (!signature || expected !== signature) {
      return res.status(400).json({ message: "Invalid webhook signature" })
    }

    const payload = JSON.parse(raw.toString())
    const event = payload.event
    const entity = payload.payload?.payment?.entity || payload.payload?.order?.entity || {}
    const rzpOrderId = entity.order_id || entity.id
    const rzpPaymentId = entity.id
    const notes = entity.notes || {}

    // We only act on successful capture/authorization
    if (event === "payment.captured" || event === "payment.authorized" || event === "order.paid") {
      // Try to match across the three order types via the razorpay order id we stored.
      // Grocery 'orders' don't store rzp order id by default — match food/assisted which do.
      let matched = false

      // food_orders.razorpay_order_id
      const fo = await pool.query(
        `UPDATE food_orders SET payment_status='paid', payment_id=COALESCE(payment_id,$1),
           order_status=CASE WHEN order_status='placed' THEN 'restaurant_pending' ELSE order_status END
         WHERE razorpay_order_id=$2 AND payment_status<>'paid' RETURNING id`,
        [rzpPaymentId, rzpOrderId])
      if (fo.rows.length > 0) matched = true

      // assisted_food_orders.customer_payment_link_id (we stored the rzp order id there)
      const ao = await pool.query(
        `UPDATE assisted_food_orders
           SET customer_food_payment_status='paid', customer_payment_id=COALESCE(customer_payment_id,$1),
               status=CASE WHEN status='food_payment_pending' THEN 'food_payment_paid' ELSE status END
         WHERE customer_payment_link_id=$2 AND customer_food_payment_status<>'paid' RETURNING id`,
        [rzpPaymentId, rzpOrderId])
      if (ao.rows.length > 0) matched = true

      console.log(`razorpay webhook ${event}: order=${rzpOrderId} matched=${matched}`)
    }

    // Always 200 quickly so Razorpay doesn't retry indefinitely
    res.json({ received: true })
  } catch (e) {
    console.log("razorpayWebhook error:", e.message)
    // Still 200 to avoid storms; we logged it
    res.json({ received: true, note: e.message })
  }
}
module.exports = razorpayWebhook
