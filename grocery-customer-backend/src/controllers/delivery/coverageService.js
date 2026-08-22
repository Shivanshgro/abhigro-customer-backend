// coverageService.js
// Radius-based fulfillment coverage (Zepto/Instamart model).
// Given a customer's coordinates, find fulfillment locations whose service
// radius reaches them, nearest first, grouped by fulfillment type.
// Falls back to pincode matching when coordinates are unavailable, so existing
// customers and GPS-denied cases still route.
//
// Adding a new dark store = one INSERT into fulfillment_locations with its
// coordinates and radius. No code change needed.

const pool = require("../../config/db")

function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => v === null || v === undefined)) return null
  const R = 6371, toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Radius match: all active/online locations whose service_radius_km covers the
 * customer's point. Returns nearest-first, with distance_km on each row.
 */
async function findLocationsByRadius(custLat, custLng, type = null) {
  if (custLat == null || custLng == null) return []
  const params = [custLat, custLng]
  let typeClause = ""
  if (type) { params.push(type); typeClause = ` AND fl.type = $3` }

  // Distance computed in SQL so the radius comparison happens server-side.
  const q = `
    SELECT fl.id, fl.name, fl.display_name, fl.type, fl.shop_id,
           fl.latitude, fl.longitude, fl.service_radius_km,
           (6371 * 2 * ASIN(SQRT(
              POWER(SIN(RADIANS(fl.latitude - $1) / 2), 2) +
              COS(RADIANS($1)) * COS(RADIANS(fl.latitude)) *
              POWER(SIN(RADIANS(fl.longitude - $2) / 2), 2)
           ))) AS distance_km
    FROM fulfillment_locations fl
    WHERE fl.is_active = true AND fl.is_online = true
      AND fl.latitude IS NOT NULL AND fl.longitude IS NOT NULL
      AND fl.orders_today < fl.daily_capacity
      ${typeClause}
    ORDER BY distance_km ASC`
  const r = await pool.query(q, params)
  // Keep only those whose radius actually reaches the customer.
  return r.rows.filter(row => Number(row.distance_km) <= Number(row.service_radius_km))
}

/**
 * Pincode fallback: locations linked to a shop in the customer's pincode.
 * Used when the customer has no coordinates.
 */
async function findLocationsByPincode(pincode, type = null) {
  if (!pincode) return []
  const params = [pincode]
  let typeClause = ""
  if (type) { params.push(type); typeClause = ` AND fl.type = $2` }
  const q = `
    SELECT fl.id, fl.name, fl.display_name, fl.type, fl.shop_id,
           fl.latitude, fl.longitude, fl.service_radius_km,
           NULL::numeric AS distance_km
    FROM fulfillment_locations fl
    JOIN shops s ON s.id = fl.shop_id
    WHERE fl.is_active = true AND fl.is_online = true
      AND s.pincode = $1
      ${typeClause}
    ORDER BY fl.id ASC`
  const r = await pool.query(q, params)
  return r.rows
}

/**
 * Main entry: best fulfillment location for a customer, for a given type.
 * Radius first (preferred), pincode fallback second.
 * Returns { location, matched_by } or { location: null, reason }.
 */
async function findBestLocation({ lat, lng, pincode, type }) {
  const byRadius = await findLocationsByRadius(lat, lng, type)
  if (byRadius.length > 0) {
    return { location: byRadius[0], matched_by: "radius", candidates: byRadius.length }
  }
  const byPincode = await findLocationsByPincode(pincode, type)
  if (byPincode.length > 0) {
    return { location: byPincode[0], matched_by: "pincode_fallback", candidates: byPincode.length }
  }
  return { location: null, reason: "no fulfillment location covers this customer" }
}

/**
 * Serviceability check for checkout: is any location able to reach this customer?
 */
async function isServiceable({ lat, lng, pincode }) {
  const r = await findBestLocation({ lat, lng, pincode, type: null })
  return { serviceable: !!r.location, matched_by: r.matched_by || null }
}

module.exports = {
  haversineKm,
  findLocationsByRadius,
  findLocationsByPincode,
  findBestLocation,
  isServiceable,
}
