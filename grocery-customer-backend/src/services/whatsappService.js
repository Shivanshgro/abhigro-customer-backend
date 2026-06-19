const axios = require("axios")

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp notifications to admin on new orders, via MSG91 WhatsApp API.
// Fully env-driven and NON-BLOCKING: a failure here never affects order creation.
//
// Required .env (only on the backend):
//   MSG91_AUTH_KEY                     your MSG91 auth key
//   MSG91_WHATSAPP_INTEGRATED_NUMBER   the WhatsApp business number registered in MSG91
//   MSG91_WHATSAPP_TEMPLATE_NAME       approved template name (with body variables)
//   MSG91_WHATSAPP_NAMESPACE           template namespace (from MSG91 dashboard)
//   ADMIN_WHATSAPP_NUMBERS             comma-separated admin numbers, e.g. 9198XXXXXXXX
//   ADMIN_WHATSAPP_LANG                template language code (default en)
//
// The template must have body placeholders {{1}}..{{7}} in this order:
//   1 order number, 2 customer name, 3 customer phone, 4 address,
//   5 total amount, 6 payment method, 7 assigned shop
// If your template differs, adjust `components` below to match it.
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_KEY = process.env.MSG91_AUTH_KEY
const INTEGRATED = process.env.MSG91_WHATSAPP_INTEGRATED_NUMBER
const TEMPLATE = process.env.MSG91_WHATSAPP_TEMPLATE_NAME
const NAMESPACE = process.env.MSG91_WHATSAPP_NAMESPACE
const LANG = process.env.MSG91_WHATSAPP_LANG || "en"

function adminNumbers() {
  return String(process.env.ADMIN_WHATSAPP_NUMBERS || "")
    .split(",").map(s => s.replace(/\D/g, "")).filter(s => s.length >= 10)
    .map(s => (s.length === 10 ? `91${s}` : s))
}

async function sendNewOrderWhatsApp(order) {
  try {
    const numbers = adminNumbers()
    if (!AUTH_KEY || !INTEGRATED || !TEMPLATE || numbers.length === 0) {
      console.log("WhatsApp not fully configured — skipping admin notification")
      return
    }

    const vars = [
      String(order.orderNumber ?? order.id ?? ""),
      String(order.customerName ?? "Customer"),
      String(order.customerPhone ?? "-"),
      String(order.address ?? "-"),
      String(order.totalAmount ?? "-"),
      String(order.paymentMethod ?? "-"),
      String(order.shopName ?? "Pending assignment"),
    ]

    const to_and_components = {}
    numbers.forEach((n, i) => {
      to_and_components[`${i}`] = {
        to: [n],
        components: {
          body_1: { type: "text", value: vars[0] },
          body_2: { type: "text", value: vars[1] },
          body_3: { type: "text", value: vars[2] },
          body_4: { type: "text", value: vars[3] },
          body_5: { type: "text", value: vars[4] },
          body_6: { type: "text", value: vars[5] },
          body_7: { type: "text", value: vars[6] },
        },
      }
    })

    await axios.post(
      "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
      {
        integrated_number: INTEGRATED,
        content_type: "template",
        payload: {
          messaging_product: "whatsapp",
          type: "template",
          template: {
            name: TEMPLATE,
            language: { code: LANG, policy: "deterministic" },
            namespace: NAMESPACE || undefined,
            to_and_components: Object.values(to_and_components),
          },
        },
      },
      { headers: { authkey: AUTH_KEY, "Content-Type": "application/json" } }
    )
    console.log(`📲 WhatsApp admin alert sent for order #${order.id}`)
  } catch (e) {
    console.log("WhatsApp send error:", e.response?.data || e.message)
  }
}

module.exports = { sendNewOrderWhatsApp }
