// ─────────────────────────────────────────────────────────────────────────────
// Pricing / fee / commission logic for the medicine module.
// Rule: medicine selling_price never exceeds MRP. AbhiGro earns from delivery
// fee + platform fee + commission + subscriptions.
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORM_FEE = Number(process.env.MED_PLATFORM_FEE || 5) // ₹5–10 per order

// Delivery fee by distance (km). Urgent handled separately.
function deliveryFee(distanceKm, urgent = false) {
  if (urgent) return Number(process.env.MED_URGENT_FEE || 69)
  const d = Number(distanceKm) || 0
  if (d <= 2) return 25
  if (d <= 5) return 35
  if (d <= 8) return 49
  return 59 // beyond 8km
}

// Commission % by product type
function commissionPercent(productType) {
  switch (String(productType || "").toLowerCase()) {
    case "prescription required":
    case "prescription":
      return Number(process.env.MED_COMM_RX || 6)      // 4–8%
    case "high-value":
    case "high_value":
      return Number(process.env.MED_COMM_HIGH || 4)     // 3–5%
    default:
      return Number(process.env.MED_COMM_OTC || 12)     // OTC/general 10–15%
  }
}

// Weighted commission across mixed-type carts (by line value)
function blendedCommissionPercent(items) {
  let value = 0, weighted = 0
  for (const it of items) {
    const line = Number(it.total_price ?? (it.selling_price * it.quantity)) || 0
    value += line
    weighted += line * commissionPercent(it.product_type)
  }
  if (value === 0) return commissionPercent("OTC")
  return Math.round((weighted / value) * 100) / 100
}

// Compute the full money breakdown for an order
function computeTotals(items, { distanceKm = 0, urgent = false, subscriptionFreeDelivery = false } = {}) {
  const medicineTotal = items.reduce(
    (s, it) => s + (Number(it.total_price ?? (it.selling_price * it.quantity)) || 0), 0)

  const fee = subscriptionFreeDelivery ? 0 : deliveryFee(distanceKm, urgent)
  const platform = PLATFORM_FEE
  const commPct = blendedCommissionPercent(items)
  const commission = Math.round(medicineTotal * commPct) / 100
  const settlement = Math.round((medicineTotal - commission) * 100) / 100
  const total = Math.round((medicineTotal + fee + platform) * 100) / 100

  return {
    total_medicine_amount: round2(medicineTotal),
    delivery_fee: round2(fee),
    platform_fee: round2(platform),
    total_amount: total,
    pharmacy_commission_percent: commPct,
    pharmacy_commission_amount: round2(commission),
    pharmacy_settlement_amount: round2(settlement),
  }
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

module.exports = { deliveryFee, commissionPercent, blendedCommissionPercent, computeTotals, PLATFORM_FEE }
