const pool = require("../../config/db")

/* ═══════════════════════════════════════════════════════════════════════
   Serviceability check.

   GET /api/service/check/:pincode
   GET /api/service/check/:pincode?lat=..&lng=..      ← preferred

   Why this changed:

   A customer standing in Akshayanagar gets a different pincode depending
   on who is asked — Google says 560114, Nominatim says 560076, and our own
   record files it under 560068. All three are defensible, because the
   locality genuinely straddles a boundary.

   Checking by pincode therefore fails at every edge, and `service_areas`
   had no row for 560114 at all. Adding that one pincode would have fixed
   one street and left the next one broken.

   So when coordinates are available we resolve by distance against
   `localities`, which is where the real serviceability lives. Pincode is
   kept as a fallback for older callers that send no coordinates.

   The response shape is unchanged, so existing frontends keep working.
   ═══════════════════════════════════════════════════════════════════════ */

// How far from a known locality centre still counts as being in it.
// Localities are a few km across, so 3 km is generous without reaching
// into the next one.
const LOCALITY_RADIUS_KM = 3

const checkPincode = async (req, res) => {
  const { pincode } = req.params
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  const haveCoords = Number.isFinite(lat) && Number.isFinite(lng)

  try {
    /* ── 1. by coordinates, when we have them ── */
    if (haveCoords) {
      const near = await pool.query(
        `SELECT l.id, l.name AS area_name,
                p.code AS pincode, c.name AS city, z.name AS region,
                ROUND((6371 * ACOS(LEAST(1,
                  COS(RADIANS($1)) * COS(RADIANS(l.latitude)) *
                  COS(RADIANS(l.longitude) - RADIANS($2)) +
                  SIN(RADIANS($1)) * SIN(RADIANS(l.latitude))
                )))::numeric, 2) AS distance_km
         FROM localities l
         JOIN pincodes p    ON p.id = l.pincode_id
         LEFT JOIN cities c ON c.id = p.city_id
         LEFT JOIN zones z  ON z.id = p.zone_id
         WHERE l.is_active = true
           AND l.is_serviceable = true
           AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
         ORDER BY distance_km
         LIMIT 1`,
        [lat, lng])

      const hit = near.rows[0]
      if (hit && Number(hit.distance_km) <= LOCALITY_RADIUS_KM) {
        // A locality with no vendor is not orderable, whatever its flags
        // say. Better to tell the customer now than at checkout.
        const v = await pool.query(
          `SELECT DISTINCT vendor_type FROM locality_primary_vendors
           WHERE locality_id = $1 AND is_active = true`, [hit.id])

        if (v.rows.length === 0) {
          return res.json({
            serviceable: false,
            message: "We're not delivering to your area yet. Coming soon! 🚀",
          })
        }

        return res.json({
          serviceable: true,
          locality_id: hit.id,
          area_name: hit.area_name,
          city: hit.city,
          region: hit.region,
          pincode: hit.pincode,
          distance_km: Number(hit.distance_km),
          verticals: v.rows.map(x => x.vendor_type),
          matched_by: "coordinates",
          message: `Delivering to ${hit.area_name}, ${hit.city} ✅`,
        })
      }

      // Coordinates given but nothing close enough. Fall through to the
      // pincode check rather than refusing outright - the coordinates may
      // be a rough map centre while the pincode is right.
    }

    /* ── 2. by pincode ── */
    if (!pincode || pincode.length !== 6) {
      return res.status(400).json({ serviceable: false, message: "Enter a valid 6-digit pincode" })
    }

    // Localities first, since that is the maintained source.
    const byPin = await pool.query(
      `SELECT l.id, l.name AS area_name, c.name AS city, z.name AS region
       FROM localities l
       JOIN pincodes p    ON p.id = l.pincode_id
       LEFT JOIN cities c ON c.id = p.city_id
       LEFT JOIN zones z  ON z.id = p.zone_id
       JOIN locality_primary_vendors lpv
            ON lpv.locality_id = l.id AND lpv.is_active = true
       WHERE p.code = $1
         AND l.is_active = true
         AND l.is_serviceable = true
       ORDER BY l.priority DESC NULLS LAST, l.name
       LIMIT 1`, [pincode])

    if (byPin.rows.length > 0) {
      const a = byPin.rows[0]
      return res.json({
        serviceable: true,
        locality_id: a.id,
        area_name: a.area_name,
        city: a.city,
        region: a.region,
        pincode,
        matched_by: "pincode",
        message: `Delivering to ${a.city || a.area_name} ✅`,
      })
    }

    // Finally the legacy table, so pincodes not yet migrated still work.
    const legacy = await pool.query(
      `SELECT pincode, area_name, city, region, is_active
       FROM service_areas WHERE pincode = $1`, [pincode])

    if (legacy.rows.length === 0 || !legacy.rows[0].is_active) {
      return res.json({
        serviceable: false,
        message: "We're not delivering to your area yet. Coming soon! 🚀",
      })
    }

    const area = legacy.rows[0]
    res.json({
      serviceable: true,
      region: area.region,
      area_name: area.area_name,
      city: area.city,
      pincode,
      matched_by: "service_areas",
      message: `Delivering to ${area.area_name}, ${area.city} ✅`,
    })
  } catch (error) {
    console.log("checkPincode error:", error.message)
    res.status(500).json({ serviceable: false, message: error.message })
  }
}

module.exports = checkPincode
