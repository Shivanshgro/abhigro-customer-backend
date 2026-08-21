// Geofence service for delivery completion.
// Reuses utils/distance.js (haversine) and the existing
// delivery_partner_locations table written by controllers/delivery/updateLocation.js.
// No new location store, no new distance maths.
const pool = require("../config/db")
const { distanceKm } = require("./distance")

const DEFAULTS = {
  delivery_geofence_meters: 100,      // radius the partner must be inside
  geofence_max_location_age_sec: 180, // reject GPS older than this
  geofence_enforce: 1,                // 0 = log only (kill switch, no redeploy needed)
}

async function getGeofenceSettings() {
  try {
    const r = await pool.query(
      `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
      [Object.keys(DEFAULTS)]
    )
    const out = { ...DEFAULTS }
    for (const row of r.rows) {
      const n = Number(row.value)
      if (!isNaN(n)) out[row.key] = n
    }
    return out
  } catch (e) {
    return { ...DEFAULTS }
  }
}

// The customer's delivery point for an order.
// Prefers the snapshot taken on the order, falls back to the linked address.
async function getCustomerPoint(orderId) {
  const q = await pool.query(
    `SELECT o.customer_latitude, o.customer_longitude,
            o.geofence_radius_m,
            a.latitude AS addr_lat, a.longitude AS addr_lng
     FROM orders o
     LEFT JOIN addresses a ON a.id = o.address_id
     WHERE o.id = $1`,
    [orderId]
  )
  if (q.rows.length === 0) return null
  const r = q.rows[0]
  const lat = r.customer_latitude ?? r.addr_lat
  const lng = r.customer_longitude ?? r.addr_lng
  if (lat == null || lng == null) return { latitude: null, longitude: null, radiusOverride: r.geofence_radius_m }
  return {
    latitude: Number(lat),
    longitude: Number(lng),
    radiusOverride: r.geofence_radius_m,
  }
}

// Latest stored partner location for this order.
async function getPartnerPoint(orderId) {
  const r = await pool.query(
    `SELECT latitude, longitude, updated_at
     FROM delivery_partner_locations WHERE order_id = $1`,
    [orderId]
  )
  if (r.rows.length === 0) return null
  return {
    latitude: Number(r.rows[0].latitude),
    longitude: Number(r.rows[0].longitude),
    updated_at: r.rows[0].updated_at,
    age_sec: Math.max(0, Math.round((Date.now() - new Date(r.rows[0].updated_at).getTime()) / 1000)),
  }
}

// Write a fresh partner fix. Used at the moment of completion so the check
// cannot be satisfied by a stale ping sent earlier from the right place.
async function recordPartnerPoint(orderId, partnerId, latitude, longitude) {
  if (latitude == null || longitude == null) return null
  const lat = Number(latitude), lng = Number(longitude)
  if (isNaN(lat) || isNaN(lng)) return null
  await pool.query(
    `INSERT INTO delivery_partner_locations
       (order_id, delivery_boy_id, latitude, longitude, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (order_id) DO UPDATE SET
       latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
       delivery_boy_id=EXCLUDED.delivery_boy_id, updated_at=NOW()`,
    [orderId, partnerId, lat, lng]
  )
  return { latitude: lat, longitude: lng, age_sec: 0 }
}

/**
 * Evaluate whether the partner is inside the delivery geofence.
 * Returns a plain object; never throws. `allowed` is the decision the
 * caller should act on — it already accounts for the enforce kill switch
 * and for orders that have no customer coordinates (legacy addresses).
 */
async function checkArrival(orderId, { latitude, longitude, partnerId } = {}) {
  const settings = await getGeofenceSettings()

  const customer = await getCustomerPoint(orderId)
  if (!customer) {
    return { allowed: false, within: false, reason: "order_not_found", enforced: true }
  }

  const radius_m = Number(customer.radiusOverride || settings.delivery_geofence_meters) || 100
  const enforced = Number(settings.geofence_enforce) === 1

  // Legacy orders whose address has no coordinates cannot be geofenced.
  // Allow, but report it so the panel can show an honest message.
  if (customer.latitude == null || customer.longitude == null) {
    return {
      allowed: true, within: false, enforced, radius_m,
      distance_m: null, reason: "no_customer_coordinates",
    }
  }

  // If a live fix was supplied, store it first, then read back what we stored.
  let partner = null
  if (latitude != null && longitude != null) {
    partner = await recordPartnerPoint(orderId, partnerId, latitude, longitude)
  }
  if (!partner) partner = await getPartnerPoint(orderId)

  if (!partner) {
    return {
      allowed: !enforced, within: false, enforced, radius_m,
      distance_m: null, reason: "no_partner_location",
    }
  }

  if (partner.age_sec > Number(settings.geofence_max_location_age_sec)) {
    return {
      allowed: !enforced, within: false, enforced, radius_m,
      distance_m: null, age_sec: partner.age_sec,
      reason: "stale_partner_location",
    }
  }

  const km = distanceKm(partner.latitude, partner.longitude, customer.latitude, customer.longitude)
  if (km == null) {
    return {
      allowed: !enforced, within: false, enforced, radius_m,
      distance_m: null, reason: "distance_unavailable",
    }
  }

  const distance_m = Math.round(km * 1000)
  const within = distance_m <= radius_m

  return {
    allowed: within || !enforced,
    within,
    enforced,
    radius_m,
    distance_m,
    age_sec: partner.age_sec,
    reason: within ? "inside_geofence" : "outside_geofence",
  }
}

const REASON_MESSAGE = {
  no_partner_location: "Turn on location sharing in the app before completing the delivery.",
  stale_partner_location: "Your location is out of date. Turn on GPS and try again.",
  distance_unavailable: "Could not read your location. Turn on GPS and try again.",
  outside_geofence: "You are not at the delivery location yet.",
}

function arrivalMessage(result) {
  const base = REASON_MESSAGE[result.reason] || "Location check failed."
  if (result.reason === "outside_geofence" && result.distance_m != null) {
    return `${base} You are ${result.distance_m}m away — you need to be within ${result.radius_m}m.`
  }
  return base
}

module.exports = {
  getGeofenceSettings,
  getCustomerPoint,
  getPartnerPoint,
  recordPartnerPoint,
  checkArrival,
  arrivalMessage,
}
