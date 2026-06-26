const axios = require("axios")

// Provider-agnostic delivery dispatch.
// Swap DELIVERY_PROVIDER env: 'borzo' | 'porter' | 'manual'
const PROVIDER = process.env.DELIVERY_PROVIDER || "manual"

async function borzo(pickup, drop, order) {
  const res = await axios.post(
    "https://robot-in.borzodelivery.com/api/business/1.6/create-order",
    {
      matter: "Groceries",
      points: [
        { address: pickup.address, contact_person: { phone: pickup.phone } },
        { address: drop.address,   contact_person: { phone: drop.phone } },
      ],
      total_weight_kg: 5,
    },
    { headers: { "X-DV-Auth-Token": process.env.BORZO_API_KEY } }
  )
  return { trackingId: res.data?.order?.order_id, status: "booked", raw: res.data }
}

async function porter(pickup, drop, order) {
  const res = await axios.post(
    "https://pfe-apigw.porter.in/v1/orders/create",
    { pickup_details: { address: pickup }, drop_details: { address: drop },
      additional_comments: `Order #${order.id}` },
    { headers: { "x-api-key": process.env.PORTER_API_KEY } }
  )
  return { trackingId: res.data?.order_id, status: "booked", raw: res.data }
}

async function manual() {
  return { trackingId: null, status: "manual", message: "Arrange delivery manually" }
}

async function bookDelivery(pickup, drop, order) {
  try {
    if (PROVIDER === "borzo")  return await borzo(pickup, drop, order)
    if (PROVIDER === "porter") return await porter(pickup, drop, order)
    return await manual()
  } catch (e) {
    console.error("Delivery booking failed:", e.message)
    return { trackingId: null, status: "failed", error: e.message }
  }
}

module.exports = { bookDelivery, PROVIDER }
