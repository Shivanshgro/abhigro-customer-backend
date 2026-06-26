// Haversine distance (km) + simple ETA/fee helpers. No external API.
function distanceKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => v === null || v === undefined || isNaN(v))) return null
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ETA window in minutes from distance. Assumes ~18 km/h city riding + prep time.
function etaMinutes(distKm, { prep = 6, speedKmh = 18 } = {}) {
  if (distKm === null) return null
  const travel = (distKm / speedKmh) * 60
  const mid = Math.round(prep + travel)
  return { low: Math.max(8, mid - 3), high: mid + 3, mid: Math.max(10, mid) }
}

// Distance-based delivery fee with admin-tunable params + optional surge.
function deliveryFee(distKm, {
  baseFee = 20, freeAboveKm = 0, perKm = 7, minFee = 0, maxFee = 80, surge = 1
} = {}) {
  if (distKm === null) return baseFee
  const billableKm = Math.max(0, distKm - freeAboveKm)
  let fee = baseFee + billableKm * perKm
  fee = fee * (surge || 1)
  fee = Math.max(minFee, Math.min(maxFee, fee))
  return Math.round(fee)
}

module.exports = { distanceKm, etaMinutes, deliveryFee }
