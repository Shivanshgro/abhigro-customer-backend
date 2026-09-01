const pool = require("../../config/db")

/* ═══════════════════════════════════════════════════════════════════════
   Order assignment.

   Previously matched a shop by `s.pincode = customer pincode`, falling
   back to `pincode_zones`. That fails for any locality whose pincode
   differs from the shop's own — Balaji sits in 560068 and an Akshayanagar
   address saves as 560114, so no shop was ever found and the order went
   unfulfilled.

   It also meant `locality_primary_vendors` — the table that actually says
   who serves where — was never consulted.

   Order of attempts now:

     1. the locality's mapped vendor        (locality_primary_vendors)
     2. the nearest shop within its radius  (coordinates)
     3. same pincode                        (original behaviour)
     4. same zone                           (original behaviour)

   Steps 3 and 4 are unchanged, so anything that worked before still works.
   Stock and capacity are checked identically at every step: a shop that
   cannot fill the basket is never assigned it, however well it matches on
   location.
   ═══════════════════════════════════════════════════════════════════════ */

/* Shared guards. A shop must be open, have room today, and hold every item.
   Kept in one place so a new matching strategy cannot accidentally skip
   them. */
const SHOP_FILTER = `
  s.is_online = true AND s.is_active = true
  AND s.orders_today < s.daily_capacity`

const STOCK_JOIN = `
  JOIN vendor_inventory vi ON vi.shop_id = s.id
   AND vi.product_id = ANY($PIDS::int[])
   AND vi.available = true AND vi.stock_qty > 0`

/* ── 1. the vendor mapped to this locality ─────────────────────────────
   The deliberate answer: someone decided this shop serves this locality. */
async function byLocality(localityId, productIds) {
  if (!localityId) return null
  const r = await pool.query(
    `SELECT s.id AS shop_id, s.priority_score, SUM(vi.price) AS approx_price
     FROM locality_primary_vendors lpv
     JOIN shops s ON s.id = lpv.vendor_id
     ${STOCK_JOIN.replace("$PIDS", "$2")}
     WHERE lpv.locality_id = $1 AND lpv.is_active = true
       AND ${SHOP_FILTER}
     GROUP BY s.id, s.priority_score
     HAVING COUNT(DISTINCT vi.product_id) = $3
     ORDER BY lpv.priority ASC, s.priority_score DESC, approx_price ASC
     LIMIT 1`,
    [localityId, productIds, productIds.length])
  return r.rows[0] || null
}

/* ── 2. nearest shop that says it delivers this far ────────────────────
   Catches addresses whose locality is not mapped yet but which sit inside
   a shop's own stated radius.                                            */
async function byDistance(lat, lng, productIds) {
  if (lat == null || lng == null) return null
  const r = await pool.query(
    `SELECT s.id AS shop_id, s.priority_score, SUM(vi.price) AS approx_price,
            (6371 * ACOS(LEAST(1,
              COS(RADIANS($1)) * COS(RADIANS(s.latitude)) *
              COS(RADIANS(s.longitude) - RADIANS($2)) +
              SIN(RADIANS($1)) * SIN(RADIANS(s.latitude))
            ))) AS km
     FROM shops s
     ${STOCK_JOIN.replace("$PIDS", "$3")}
     WHERE ${SHOP_FILTER}
       AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
     GROUP BY s.id, s.priority_score, s.latitude, s.longitude, s.delivery_radius_km
     HAVING COUNT(DISTINCT vi.product_id) = $4
        -- Never assign beyond what the shop itself said it will deliver.
        AND (6371 * ACOS(LEAST(1,
              COS(RADIANS($1)) * COS(RADIANS(s.latitude)) *
              COS(RADIANS(s.longitude) - RADIANS($2)) +
              SIN(RADIANS($1)) * SIN(RADIANS(s.latitude))
            ))) <= COALESCE(s.delivery_radius_km, 5)
     ORDER BY km ASC, s.priority_score DESC
     LIMIT 1`,
    [lat, lng, productIds, productIds.length])
  return r.rows[0] || null
}

/* ── 3 & 4. the original pincode and zone matching ─────────────────── */
async function byPincode(pincode, productIds, useZone) {
  if (!pincode) return null
  const locationClause = useZone
    ? `s.zone = (SELECT zone FROM pincode_zones WHERE pincode = $1)`
    : `s.pincode = $1`
  const r = await pool.query(
    `SELECT s.id AS shop_id, s.priority_score, SUM(vi.price) AS approx_price
     FROM shops s
     ${STOCK_JOIN.replace("$PIDS", "$2")}
     WHERE ${SHOP_FILTER} AND ${locationClause}
     GROUP BY s.id, s.priority_score
     HAVING COUNT(DISTINCT vi.product_id) = $3
     ORDER BY s.priority_score DESC, approx_price ASC
     LIMIT 1`,
    [pincode, productIds, productIds.length])
  return r.rows[0] || null
}

/* Work out which locality an address sits in, by coordinates first and
   pincode second — the same order the serviceability check uses, so the
   two cannot disagree about where a customer is. */
async function resolveLocality(addressId, pincode) {
  let lat = null, lng = null
  try {
    if (addressId) {
      const a = await pool.query(
        `SELECT latitude, longitude, pincode FROM addresses WHERE id = $1`, [addressId])
      if (a.rows[0]) {
        lat = a.rows[0].latitude != null ? Number(a.rows[0].latitude) : null
        lng = a.rows[0].longitude != null ? Number(a.rows[0].longitude) : null
        pincode = pincode || a.rows[0].pincode
      }
    }
  } catch (e) { console.log("resolveLocality address:", e.message) }

  if (lat != null && lng != null) {
    try {
      const r = await pool.query(
        `SELECT l.id,
                (6371 * ACOS(LEAST(1,
                  COS(RADIANS($1)) * COS(RADIANS(l.latitude)) *
                  COS(RADIANS(l.longitude) - RADIANS($2)) +
                  SIN(RADIANS($1)) * SIN(RADIANS(l.latitude))
                ))) AS km
         FROM localities l
         WHERE l.is_active = true AND l.is_serviceable = true
           AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
         ORDER BY km ASC LIMIT 1`, [lat, lng])
      if (r.rows[0] && Number(r.rows[0].km) <= 3) {
        return { localityId: r.rows[0].id, lat, lng }
      }
    } catch (e) { console.log("resolveLocality coords:", e.message) }
  }

  try {
    const r = await pool.query(
      `SELECT l.id FROM localities l
       JOIN pincodes p ON p.id = l.pincode_id
       WHERE p.code = $1 AND l.is_active = true AND l.is_serviceable = true
       ORDER BY l.priority DESC NULLS LAST LIMIT 1`, [pincode])
    if (r.rows[0]) return { localityId: r.rows[0].id, lat, lng }
  } catch (e) { console.log("resolveLocality pincode:", e.message) }

  return { localityId: null, lat, lng }
}

async function autoAssignOrder(orderId, pincode, items, addressId = null) {
  if (!items || items.length === 0) {
    await pool.query(`UPDATE orders SET assignment_status='unfulfilled' WHERE id=$1`, [orderId])
    return { assigned: false, reason: "no items" }
  }
  const productIds = items.map(i => i.product_id)

  const { localityId, lat, lng } = await resolveLocality(addressId, pincode)

  let shop = null, matchedBy = null
  if (localityId) {
    shop = await byLocality(localityId, productIds)
    if (shop) matchedBy = "locality vendor"
  }
  if (!shop) {
    shop = await byDistance(lat, lng, productIds)
    if (shop) matchedBy = "nearest shop in radius"
  }
  if (!shop) {
    shop = await byPincode(pincode, productIds, false)
    if (shop) matchedBy = "same pincode"
  }
  if (!shop) {
    shop = await byPincode(pincode, productIds, true)
    if (shop) matchedBy = "nearby zone"
  }

  if (!shop) {
    await pool.query(`UPDATE orders SET assignment_status='unfulfilled' WHERE id=$1`, [orderId])
    return {
      assigned: false,
      reason: localityId
        ? "no online vendor with all items in stock"
        : "address could not be matched to a serviceable locality",
      locality_id: localityId,
    }
  }

  const shopId = shop.shop_id
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `UPDATE orders SET assigned_shop_id=$1, assignment_status='assigned', status='Confirmed' WHERE id=$2`,
      [shopId, orderId])
    for (const it of items) {
      await client.query(
        `UPDATE vendor_inventory SET stock_qty = GREATEST(0, stock_qty - $1),
         available = (stock_qty - $1) > 0, updated_at = NOW()
         WHERE shop_id=$2 AND product_id=$3`,
        [it.quantity || 1, shopId, it.product_id])
    }
    await client.query(`UPDATE shops SET orders_today = orders_today + 1 WHERE id=$1`, [shopId])
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK"); throw e
  } finally { client.release() }

  console.log(`[Assign] order ${orderId} -> shop ${shopId} (${matchedBy})`)
  return { assigned: true, shop_id: shopId, matched_by: matchedBy, locality_id: localityId }
}

async function reassignFailedOrder(orderId) {
  const o = await pool.query(
    `SELECT pincode, address_id, assigned_shop_id FROM orders WHERE id=$1`, [orderId])
  if (o.rows.length === 0) return { assigned: false, reason: "order not found" }
  if (o.rows[0].assigned_shop_id) {
    await pool.query(`UPDATE shops SET priority_score = GREATEST(0, priority_score - 10) WHERE id=$1`,
      [o.rows[0].assigned_shop_id])
  }
  const items = await pool.query(`SELECT product_id, quantity FROM order_items WHERE order_id=$1`, [orderId])
  return await autoAssignOrder(orderId, o.rows[0].pincode, items.rows, o.rows[0].address_id)
}

module.exports = { autoAssignOrder, reassignFailedOrder }
