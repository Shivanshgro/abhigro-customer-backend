const express = require("express")
const router = express.Router()
const pool = require("../config/db")

/* ═══════════════════════════════════════════════════════════════════════
   Area picker.

   Previously read `service_areas` — a hand-maintained list of 27 rows with
   no coordinates. Meanwhile `localities` carried coordinates, per-vertical
   vendor mappings and serviceability flags, and nothing in the codebase
   read it. Adding a locality there had no effect on anything, which is why
   Akshayanagar (and HSR, Koramangala, JP Nagar, Jayanagar) never appeared.

   These endpoints now read `localities`, joined through `pincodes` for the
   pincode itself and `locality_primary_vendors` for who actually fulfils
   the order.

   Two flags, deliberately kept distinct:
     is_serviceable  a shop can physically reach it
     is_active       we have opened it to customers

   Both must be true. A locality that a shop could reach is not the same as
   one we have promised to deliver to, and collapsing the two is how an
   area opens before anyone is ready to serve it.

   `service_areas` remains the fallback for pincodes that have no localities
   yet, so nothing that works today stops working.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── GET /api/area/list/:pincode ────────────────────────────────────────
   Every locality a customer can pick for this pincode.                    */
router.get("/list/:pincode", async (req, res) => {
  const pincode = String(req.params.pincode || "").trim()
  if (!/^\d{6}$/.test(pincode)) {
    return res.status(400).json({ success: false, message: "Enter a valid 6-digit pincode" })
  }

  try {
    const r = await pool.query(
      `SELECT l.id            AS locality_id,
              l.name          AS area_name,
              l.latitude, l.longitude,
              c.name          AS city,
              z.name          AS region,
              p.code          AS pincode,
              TRUE            AS is_active,
              -- Which verticals can actually be fulfilled here. A locality
              -- with no vendor is not orderable however its flags read.
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT lpv.vendor_type), NULL) AS verticals
       FROM localities l
       JOIN pincodes p        ON p.id = l.pincode_id
       LEFT JOIN cities c     ON c.id = p.city_id
       LEFT JOIN zones z      ON z.id = p.zone_id
       LEFT JOIN locality_primary_vendors lpv
              ON lpv.locality_id = l.id AND lpv.is_active = true
       WHERE p.code = $1
         AND l.is_active = true
         AND l.is_serviceable = true
       GROUP BY l.id, l.name, l.latitude, l.longitude, c.name, z.name, p.code
       ORDER BY l.priority DESC NULLS LAST, l.name`,
      [pincode])

    if (r.rows.length > 0) {
      return res.json({ success: true, source: "localities", areas: r.rows })
    }

    // No localities mapped for this pincode yet — fall back so existing
    // areas keep working while the data is migrated.
    const legacy = await pool.query(
      `SELECT area_name, city, region, is_active
       FROM service_areas
       WHERE pincode = $1 AND area_name IS NOT NULL
       ORDER BY area_name`, [pincode])

    res.json({ success: true, source: "service_areas", areas: legacy.rows })
  } catch (e) {
    console.log("area list error:", e.message)
    res.status(500).json({ success: false, message: e.message })
  }
})

/* ── GET /api/area/search?q= ────────────────────────────────────────────
   Type-ahead across every open locality.                                  */
router.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim()
  if (q.length < 2) return res.json({ success: true, areas: [] })

  try {
    const r = await pool.query(
      `SELECT l.id AS locality_id, l.name AS area_name,
              p.code AS pincode, c.name AS city, z.name AS region,
              l.latitude, l.longitude, TRUE AS is_active
       FROM localities l
       JOIN pincodes p    ON p.id = l.pincode_id
       LEFT JOIN cities c ON c.id = p.city_id
       LEFT JOIN zones z  ON z.id = p.zone_id
       WHERE l.name ILIKE $1
         AND l.is_active = true
         AND l.is_serviceable = true
       ORDER BY
         -- Names that start with the query first; "Beg" should find
         -- "Begur Road" before "Garvebhavi Palya".
         CASE WHEN l.name ILIKE $2 THEN 0 ELSE 1 END,
         l.priority DESC NULLS LAST, l.name
       LIMIT 10`,
      [`%${q}%`, `${q}%`])

    if (r.rows.length > 0) return res.json({ success: true, source: "localities", areas: r.rows })

    const legacy = await pool.query(
      `SELECT pincode, area_name, city, region, is_active
       FROM service_areas
       WHERE area_name ILIKE $1
       ORDER BY is_active DESC, area_name LIMIT 8`, [`%${q}%`])

    res.json({ success: true, source: "service_areas", areas: legacy.rows })
  } catch (e) {
    console.log("area search error:", e.message)
    res.status(500).json({ success: false, message: e.message })
  }
})

/* ── GET /api/area/nearest?lat=&lng= ────────────────────────────────────
   Resolve GPS to a locality. There was no way to do this before, which is
   why a customer's location never mapped to anything.

   Uses plain Haversine rather than PostGIS, so it works on the database
   as it stands.                                                           */
router.get("/nearest", async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ success: false, message: "lat and lng required" })
  }
  const within = Math.min(15, Number(req.query.within_km) || 6)

  try {
    const r = await pool.query(
      `SELECT l.id AS locality_id, l.name AS area_name,
              p.code AS pincode, c.name AS city, z.name AS region,
              l.latitude, l.longitude,
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
       LIMIT 5`,
      [lat, lng])

    const near = r.rows.filter(x => Number(x.distance_km) <= within)

    res.json({
      success: true,
      serviceable: near.length > 0,
      nearest: near[0] || null,
      // The next few, so the picker can offer alternatives rather than a
      // dead end when someone sits just outside a boundary.
      alternatives: near.slice(1),
      message: near.length > 0
        ? `Delivering to ${near[0].area_name} ✅`
        : "We're not delivering to your area yet.",
    })
  } catch (e) {
    console.log("area nearest error:", e.message)
    res.status(500).json({ success: false, message: e.message })
  }
})

/* ── GET /api/area/:id/vendors ──────────────────────────────────────────
   Who fulfils each vertical in a locality.                                */
router.get("/:id/vendors", async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Bad id" })

  try {
    const r = await pool.query(
      `SELECT lpv.vendor_type, lpv.vendor_id, lpv.priority,
              s.shop_name, s.is_online, s.is_active
       FROM locality_primary_vendors lpv
       LEFT JOIN shops s ON s.id = lpv.vendor_id
       WHERE lpv.locality_id = $1 AND lpv.is_active = true
       ORDER BY lpv.vendor_type, lpv.priority`, [id])

    res.json({ success: true, vendors: r.rows })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
})

module.exports = router
