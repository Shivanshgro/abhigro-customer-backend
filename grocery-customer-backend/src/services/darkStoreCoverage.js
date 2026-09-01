const pool = require("../config/db")

/* ═══════════════════════════════════════════════════════════════════════
   Dark store coverage.

   Onboard a store, give it a location and a delivery radius, and this maps
   every locality inside that radius to it for grocery, vegetables and
   fruit. Assignment then reads those mappings, so a new store starts
   receiving orders without anyone writing SQL.

   Two deliberate choices:

   1. It never steals a locality that already has a store, unless you pass
      takeover. Two stores silently fighting over the same street is worse
      than a locality being left unmapped and visible.

   2. It only maps localities that are already active and serviceable.
      Being near a store does not make a place deliverable — someone still
      has to decide to open it.
   ═══════════════════════════════════════════════════════════════════════ */

const VERTICALS = ["grocery", "vegetable", "fruit"]

/* Localities inside the store's radius, with what already covers them. */
async function coverageFor(shopId, radiusOverride) {
  const s = await pool.query(
    `SELECT id, shop_name, latitude, longitude,
            COALESCE(delivery_radius_km, 5) AS radius
     FROM shops WHERE id = $1`, [shopId])

  if (s.rows.length === 0) return { error: "Shop not found" }
  const shop = s.rows[0]

  if (shop.latitude == null || shop.longitude == null) {
    return { error: `${shop.shop_name} has no coordinates. Set them before mapping.` }
  }

  const radius = Number(radiusOverride) > 0 ? Number(radiusOverride) : Number(shop.radius)

  const r = await pool.query(
    `SELECT l.id, l.name, p.code AS pincode, z.name AS zone,
            ROUND((6371 * ACOS(LEAST(1,
              COS(RADIANS($1)) * COS(RADIANS(l.latitude)) *
              COS(RADIANS(l.longitude) - RADIANS($2)) +
              SIN(RADIANS($1)) * SIN(RADIANS(l.latitude))
            )))::numeric, 2) AS km,
            -- who covers it today, if anyone
            (SELECT lpv.vendor_id FROM locality_primary_vendors lpv
             WHERE lpv.locality_id = l.id AND lpv.is_active = true
             LIMIT 1) AS current_vendor_id
     FROM localities l
     JOIN pincodes p    ON p.id = l.pincode_id
     LEFT JOIN zones z  ON z.id = p.zone_id
     WHERE l.is_active = true AND l.is_serviceable = true
       AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
     ORDER BY km ASC`,
    [Number(shop.latitude), Number(shop.longitude)])

  const inside = r.rows.filter(x => Number(x.km) <= radius)

  return {
    shop: { id: shop.id, name: shop.shop_name, radius_km: radius },
    localities: inside.map(x => ({
      id: x.id, name: x.name, pincode: x.pincode, zone: x.zone,
      distance_km: Number(x.km),
      status: x.current_vendor_id == null ? "unmapped"
        : Number(x.current_vendor_id) === Number(shopId) ? "already yours"
          : "covered by another store",
      current_vendor_id: x.current_vendor_id,
    })),
  }
}

/* Preview only — nothing is written. Worth looking at before mapping a
   store that sits near an existing one. */
async function previewCoverage(shopId, radius) {
  const c = await coverageFor(shopId, radius)
  if (c.error) return c

  const by = (s) => c.localities.filter(l => l.status === s)
  return {
    ...c,
    summary: {
      total: c.localities.length,
      will_map: by("unmapped").length,
      already_yours: by("already yours").length,
      held_by_others: by("covered by another store").length,
    },
  }
}

/* Do the mapping. */
async function mapCoverage(shopId, { radius, takeover = false, verticals = VERTICALS } = {}) {
  const c = await coverageFor(shopId, radius)
  if (c.error) return c

  const targets = c.localities.filter(l =>
    l.status === "unmapped" || (takeover && l.status === "covered by another store"))

  if (targets.length === 0) {
    return { ...c, mapped: 0, message: "Nothing to map — every locality in range is already covered." }
  }

  const client = await pool.connect()
  let written = 0
  try {
    await client.query("BEGIN")
    for (const loc of targets) {
      if (takeover && loc.current_vendor_id != null) {
        // Retire the old mapping rather than deleting it, so the change is
        // visible if someone asks why a locality moved.
        await client.query(
          `UPDATE locality_primary_vendors SET is_active = false
           WHERE locality_id = $1 AND is_active = true`, [loc.id])
      }
      for (const v of verticals) {
        const res = await client.query(
          `INSERT INTO locality_primary_vendors
             (locality_id, vendor_type, vendor_id, priority, is_active)
           SELECT $1, $2, $3, 1, true
           WHERE NOT EXISTS (
             SELECT 1 FROM locality_primary_vendors
             WHERE locality_id = $1 AND vendor_type = $2 AND vendor_id = $3)`,
          [loc.id, v, shopId])
        written += res.rowCount
      }
    }
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK")
    console.log("mapCoverage error:", e.message)
    return { error: e.message }
  } finally {
    client.release()
  }

  console.log(`[Coverage] shop ${shopId} mapped to ${targets.length} localities (${written} rows)`)

  return {
    shop: c.shop,
    mapped: targets.length,
    rows: written,
    localities: targets.map(l => ({ name: l.name, distance_km: l.distance_km })),
    message: `${c.shop.name} now covers ${targets.length} localities.`,
  }
}

module.exports = { previewCoverage, mapCoverage, coverageFor }
