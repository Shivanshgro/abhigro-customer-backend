const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const pool = require("../config/db")

const KB = {
  place_order: "To place an order: select your location, browse categories or search, add items to cart, and checkout with COD or online payment (Razorpay). 🛒",
  delivery: "We deliver from nearby trusted stores. Typical delivery time is 30–45 minutes depending on your area and order type. 🛵",
  areas: "We currently serve Bengaluru areas like Bommanahalli, HSR Layout, BTM Layout, Electronic City, Koramangala and more — with new areas coming soon. Check the Service Areas section on the homepage. 📍",
  payment: "We accept Cash on Delivery (COD) and online payments via Razorpay (UPI, cards, netbanking). 💳",
  refund_policy: "Refunds: for missing, wrong, or damaged items, raise a request here — our team reviews it and refunds are processed to your original payment method or wallet. Refund requests are reviewed manually to keep things fair. 🔄",
  cancel_policy: "You can cancel an order before it's packed. After packing, cancellation needs admin approval — I can raise that request for you.",
  pharmacy: "For medicine orders, a valid prescription is required for prescription medicines. I can help with order status, prescription upload issues, and refunds — but for medical advice, please consult a qualified doctor or pharmacist. 💊",
  partner: "Want to partner with AbhiGro? Register from the homepage: Vendor, Pharmacy, Restaurant, or Delivery Partner — approval usually takes 1-2 days. 🤝",
  charges: "Delivery charges depend on your order value — orders above ₹299 get free delivery. Exact charges show in your cart before checkout.",
  wallet: "Your AbhiGro Wallet holds refund and promo credits. Check balance and history in Account → Wallet.",
  coupon: "Find coupons in Account → Coupons and tap Apply — it auto-fills at checkout. If a coupon fails, it may be expired or below minimum order value.",
  subscription: "Subscriptions deliver daily essentials (milk, curd, bread) every morning. Manage, pause, or skip days from Account → Subscription.",
}

const CANCELLABLE = ["Pending", "Placed", "Confirmed", "Accepted", "pending", "placed", "confirmed"]

async function latestOrders(userId, n = 3) {
  const r = await pool.query(
    `SELECT id, status, payment_status, payment_method, total_amount, created_at
     FROM orders WHERE user_id=$1 ORDER BY id DESC LIMIT $2`, [userId, n])
  return r.rows
}
async function getOrder(userId, id) {
  const r = await pool.query(
    `SELECT o.*, s.shop_name FROM orders o LEFT JOIN shops s ON s.id=o.assigned_shop_id
     WHERE o.id=$1 AND o.user_id=$2`, [id, userId])
  return r.rows[0]
}
function orderLine(o) {
  return `Order #${o.id} — status: ${o.status || "Placed"}, payment: ${o.payment_status || o.payment_method || "—"}, amount ₹${o.total_amount}.`
}
async function makeTicket(userId, { order_id = null, issue_type, message, image = "", priority = "medium", summary = "" }) {
  const r = await pool.query(
    `INSERT INTO support_tickets (user_id, order_id, issue_type, message, image, priority, ai_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [userId, order_id, issue_type, message, image, priority, summary])
  try {
    const notify = require("../services/notify")
    notify({ to: "admin", type: "support", title: `Support: ${issue_type.replace(/_/g, " ")}${order_id ? " (order #" + order_id + ")" : ""}`,
             message: (summary || message).slice(0, 140), data: { ticket_id: r.rows[0].id } })
    notify({ to: "customer", userId, type: "support", title: `Ticket #${r.rows[0].id} created`,
             message: "Our team will review it and update you here.", data: { ticket_id: r.rows[0].id } })
  } catch (e) {}
  return r.rows[0]
}

// GET /api/supportbot/context — recent orders for the selector
router.get("/context", auth, async (req, res) => {
  try { res.json({ success: true, orders: await latestOrders(req.user.id, 5) }) }
  catch (e) { res.status(500).json({ message: e.message }) }
})

// POST /api/supportbot/message { intent, text, order_id, image }
router.post("/message", auth, async (req, res) => {
  try {
    const uid = req.user.id
    const { intent = "", text = "", order_id = null, image = "" } = req.body
    const t = (text || "").toLowerCase()
    const has = (...ws) => ws.some(w => t.includes(w))
    let i = intent

    if (!i) { // lightweight NLU (rule-based; AI hook: swap this block for an LLM call later)
      if (has("where is my order", "order status", "track", "kaha hai", "not delivered", "late", "delay")) i = "order_status"
      else if (has("cancel")) i = "cancel_order"
      else if (has("refund")) i = "refund_request"
      else if (has("missing")) i = "missing_item"
      else if (has("wrong item", "different item")) i = "wrong_item"
      else if (has("damaged", "broken", "leaking", "expired")) i = "damaged_item"
      else if (has("deducted", "payment failed", "money", "paid but")) i = "payment_issue"
      else if (has("address")) i = "address_change"
      else if (has("prescription")) i = "pharmacy_help"
      else if (has("medicine", "pharmacy", "tablet", "dose", "medical")) i = "pharmacy_help"
      else if (has("coupon", "promo")) i = "kb_coupon"
      else if (has("wallet")) i = "kb_wallet"
      else if (has("subscription", "daily milk")) i = "kb_subscription"
      else if (has("deliver", "how long", "eta", "time")) i = "kb_delivery"
      else if (has("pay", "cod", "upi")) i = "kb_payment"
      else if (has("area", "location", "serviceable")) i = "kb_areas"
      else if (has("partner", "register", "vendor", "sell")) i = "kb_partner"
      else if (has("how to order", "place order")) i = "kb_place_order"
      else if (has("refund policy")) i = "kb_refund_policy"
      else i = "fallback"
    }

    if (i.startsWith("kb_")) {
      const key = i.slice(3)
      return res.json({ success: true, reply: KB[key] || KB.place_order })
    }

    if (i === "order_status") {
      let o = order_id ? await getOrder(uid, order_id) : (await latestOrders(uid, 1))[0]
      if (!o) return res.json({ success: true, reply: "I couldn't find any orders on your account yet. Once you place an order, I can track it for you! 🛒" })
      let eta = ["Out For Delivery", "Picked Up"].includes(o.status) ? " Expected delivery in 30–45 minutes. 🛵" : ""
      return res.json({ success: true, reply: `${orderLine(o)}${o.shop_name ? ` Being handled by ${o.shop_name}.` : ""}${eta}` })
    }

    if (i === "cancel_order") {
      if (!order_id) return res.json({ success: true, reply: "Which order would you like to cancel? Please select it below.", need: "order" })
      const o = await getOrder(uid, order_id)
      if (!o) return res.json({ success: true, reply: "I couldn't find that order on your account." })
      if (CANCELLABLE.includes(o.status)) {
        const tk = await makeTicket(uid, { order_id, issue_type: "cancel_request", message: text || "Customer requested cancellation via chat", priority: "high",
          summary: `Customer requested cancellation of order #${order_id} (status ${o.status}, ₹${o.total_amount}). Eligible: not yet packed.` })
        return res.json({ success: true, reply: `Your cancellation request for order #${order_id} has been created (Ticket #${tk.id}). Since it isn't packed yet, it will be processed quickly. ✅`, ticket: tk })
      }
      const tk = await makeTicket(uid, { order_id, issue_type: "cancel_request", message: text || "Cancellation after packing", priority: "high",
        summary: `Customer requested cancellation of order #${order_id} AFTER packing (status ${o.status}). Needs admin approval.` })
      return res.json({ success: true, reply: `Order #${order_id} is already ${o.status}, so cancellation needs admin approval. I've raised Ticket #${tk.id} — our team will review it and update you. 🙏`, ticket: tk })
    }

    if (["missing_item", "wrong_item", "damaged_item", "refund_request"].includes(i)) {
      if (!order_id) return res.json({ success: true, reply: "I'm sorry about that! Which order is this about? Please select it below.", need: "order" })
      if ((i === "wrong_item" || i === "damaged_item") && !image && !text)
        return res.json({ success: true, reply: "Could you describe the item (and upload a photo if possible)? It helps our team resolve this faster. 📷", need: "detail" })
      const tk = await makeTicket(uid, { order_id, issue_type: i, message: text || i.replace(/_/g, " "), image, priority: "high",
        summary: `Customer reported ${i.replace(/_/g, " ")} on order #${order_id}. ${text ? "Details: " + text.slice(0, 200) : ""}${image ? " Photo attached." : ""} Refund/replacement review needed.` })
      return res.json({ success: true, reply: `I've created Ticket #${tk.id} for this${i === "refund_request" ? " refund request" : ""}. Our team will review it shortly and any refund will be updated to you here and in your wallet. 🙏`, ticket: tk })
    }

    if (i === "payment_issue") {
      const o = (await latestOrders(uid, 1))[0]
      if (o && (o.payment_status === "paid" || o.status)) {
        const tk = await makeTicket(uid, { order_id: o.id, issue_type: "payment_issue", message: text || "Payment deducted / issue reported via chat", priority: "high",
          summary: `Payment issue reported. Latest order #${o.id}: status ${o.status}, payment ${o.payment_status || "unknown"}. Verify against Razorpay and refund if double-charged.` })
        return res.json({ success: true, reply: `I checked — your latest order is #${o.id} (${o.status}, payment: ${o.payment_status || "pending"}). If money was deducted without an order, don't worry: failed payments are auto-refunded by the bank in 5–7 days. I've also raised Ticket #${tk.id} so our team verifies it. 💳`, ticket: tk })
      }
      const tk = await makeTicket(uid, { issue_type: "payment_issue", message: text || "Payment issue", priority: "high", summary: "Payment issue reported; no recent order found. Verify in Razorpay dashboard." })
      return res.json({ success: true, reply: `I've raised Ticket #${tk.id} for the payment issue. If money was deducted, it's typically auto-refunded in 5–7 days — our team will verify and update you. 💳`, ticket: tk })
    }

    if (i === "address_change") {
      const tk = await makeTicket(uid, { order_id, issue_type: "address_change", message: text || "Address change requested", priority: "medium",
        summary: `Customer requested address change${order_id ? " for order #" + order_id : ""}. ${text.slice(0, 150)}` })
      return res.json({ success: true, reply: `Got it — I've raised Ticket #${tk.id} for the address change. If the order is already out for delivery, our team will try their best but can't guarantee it. You can also manage addresses in Account → Addresses. 📍`, ticket: tk })
    }

    if (i === "pharmacy_help") {
      if (has("advice", "should i take", "dose", "dosage", "which medicine"))
        return res.json({ success: true, reply: "I can't give medical advice — please consult a qualified doctor or pharmacist for that. 🩺 I *can* help with medicine order status, prescription upload issues, or refunds. What's the issue?" })
      const tk = text ? await makeTicket(uid, { order_id, issue_type: "pharmacy_issue", message: text, priority: "high",
        summary: `Pharmacy/medicine issue: ${text.slice(0, 200)}` }) : null
      return res.json({ success: true, reply: tk
        ? `I've raised Ticket #${tk.id} for your pharmacy issue — our team will review it shortly. For medical advice, please consult a qualified doctor or pharmacist. 💊`
        : KB.pharmacy, ticket: tk || undefined })
    }

    // fallback -> ticket
    const tk = await makeTicket(uid, { order_id, issue_type: "other", message: text || "Customer query via chat", priority: "low",
      summary: `Unclassified query: "${(text || "").slice(0, 200)}"` })
    return res.json({ success: true, reply: `I've created a support ticket for this (Ticket #${tk.id}). AbhiGro team will review it and update you. Meanwhile, is there anything else I can help with? 🙂`, ticket: tk })
  } catch (e) { res.status(500).json({ message: e.message }) }
})

// ---- ADMIN ticket management (admin token works — shared JWT secret) ----
const adminOnly = (req, res, next) => { if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin only" }); next() }
router.get("/admin/tickets", auth, adminOnly, async (req, res) => {
  try {
    const st = req.query.status
    const r = st
      ? await pool.query(`SELECT t.*, u.name AS customer_name, u.mobile FROM support_tickets t LEFT JOIN users u ON u.id=t.user_id WHERE t.status=$1 ORDER BY t.created_at DESC LIMIT 100`, [st])
      : await pool.query(`SELECT t.*, u.name AS customer_name, u.mobile FROM support_tickets t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 100`)
    res.json({ success: true, tickets: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
})
router.put("/admin/tickets/:id", auth, adminOnly, async (req, res) => {
  try {
    const { status, admin_note, priority } = req.body
    const r = await pool.query(
      `UPDATE support_tickets SET status=COALESCE($1,status), admin_note=COALESCE($2,admin_note),
       priority=COALESCE($3,priority), updated_at=NOW() WHERE id=$4 RETURNING *`,
      [status, admin_note, priority, req.params.id])
    if (!r.rows[0]) return res.status(404).json({ message: "Not found" })
    try {
      require("../services/notify")({ to: "customer", userId: r.rows[0].user_id, type: "support",
        title: `Ticket #${r.rows[0].id} ${r.rows[0].status.replace(/_/g, " ")}`,
        message: admin_note || "Your support ticket was updated.", data: { ticket_id: r.rows[0].id } })
    } catch (e) {}
    res.json({ success: true, ticket: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
})
module.exports = router
