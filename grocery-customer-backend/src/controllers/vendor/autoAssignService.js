const pool = require("../../config/db")

/* ═══════════════════════════════════════════════════════════════════════
   Order assignment.

   The rule, in one line:
     the locality decides the shop.

   Onboard a store, map the localities near it in locality_primary_vendors,
   and orders from those localities go to that store.

   What was removed, and why
   ─────────────────────────
   The previous version joined vendor_inventory and required a shop to hold
   EVERY item in the basket before it could be assigned. That needed the
   GROUP BY / HAVING which broke, and it was doing more harm than good: an
   order with one out-of-stock item was left unfulfilled rather than sent
   to the shop that could pack the other nine.

   The vendor panel already handles a missing item — the packer taps OUT
   and the customer is told. That is a better outcome than an order nobody
   ever sees.

   The trade: a shop can now be assigned an order it cannot completely
   fill. With one store holding the full catalogue that is the right way
   round. If you later run stores with genuinely different stock, this is
   the decision to revisit.

   Order of attempts:
     1. the locality's mapped vendor
     2. the nearest open shop within its own delivery radius
     3. same pincode          (kept so nothing that worked before breaks)
   ═══════════════════════════════════════════════════════════════════════ */

/* A shop must be open and under its daily cap. Nothing else. */
const OPEN = `s.is_online = true AND s.is_active = true
              AND s.orders_today < COALESCE(s.daily_capacity, 999)`

/* ── which locality is this address in? ────────────────────────────────
   Coordinates first, pincode second — the same order the serviceability
   check uses, so the two never disagree about where a customer is.       */
async function resolveLocality(addressId, pincode) {
  let lat = null, lng = null

  if (addressId) {
    try {
      const a = await pool.query(
        `SELECT latitude, longitude, pincode FROM addresses WHERE id = $1`, [addressId])
      if (a.rows[0]) {
        lat = a.rows[0].latitude != null ? Number(a.rows[0].latitude) : null
        lng = a.rows[0].longitude != null ? Number(a.rows[0].longitude) : null
        pincode = pincode || a.rows[0].pincode
      }
    } catch (e) { console.log("resolveLocality address:", e.message) }
  }

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
      if (r.rows[0] && Number(r.rows[0].km) <= 3) return { localityId: r.rows[0].id, lat, lng }
    } catch (e) { console.log("resolveLocality coords:", e.message) }
  }

  if (pincode) {
    try {
      const r = await pool.query(
        `SELECT l.id FROM localities l
         JOIN pincodes p ON p.id = l.pincode_id
         WHERE p.code = $1 AND l.is_active = true AND l.is_serviceable = true
         ORDER BY l.priority DESC NULLS LAST LIMIT 1`, [pincode])
      if (r.rows[0]) return { localityId: r.rows[0].id, lat, lng }
    } catch (e) { console.log("resolveLocality pincode:", e.message) }
  }

  return { localityId: null, lat, lng }
}

/* ── 1. the shop mapped to this locality ── */
async function byLocality(localityId) {
  if (!localityId) return null
  const r = await pool.query(
    `SELECT s.id AS shop_id
     FROM locality_primary_vendors lpv
     JOIN shops s ON s.id = lpv.vendor_id
     WHERE lpv.locality_id = $1 AND lpv.is_active = true AND ${OPEN}
     ORDER BY lpv.priority ASC, s.priority_score DESC
     LIMIT 1`, [localityId])
  return r.rows[0] || null
}

/* ── 2. nearest shop that says it delivers this far ── */
async function byDistance(lat, lng) {
  if (lat == null || lng == null) return null
  const r = await pool.query(
    `SELECT s.id AS shop_id, COALESCE(s.delivery_radius_km, 5) AS radius,
            (6371 * ACOS(LEAST(1,
              COS(RADIANS($1)) * COS(RADIANS(s.latitude)) *
              COS(RADIANS(s.longitude) - RADIANS($2)) +
              SIN(RADIANS($1)) * SIN(RADIANS(s.latitude))
            ))) AS km
     FROM shops s
     WHERE ${OPEN}
       AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
     ORDER BY km ASC LIMIT 1`, [lat, lng])

  const hit = r.rows[0]
  // Never assign past what the shop itself said it will deliver.
  if (!hit || Number(hit.km) > Number(hit.radius)) return null
  return hit
}

/* ── 3. same pincode, as before ── */
async function byPincode(pincode) {
  if (!pincode) return null
  const r = await pool.query(
    `SELECT s.id AS shop_id FROM shops s
     WHERE ${OPEN} AND s.pincode = $1
     ORDER BY s.priority_score DESC LIMIT 1`, [pincode])
  return r.rows[0] || null
}

async function autoAssignOrder(orderId, pincode, items, addressId = null) {
  const { localityId, lat, lng } = await resolveLocality(addressId, pincode)

  let shop = await byLocality(localityId)
  let matchedBy = "locality vendor"

  if (!shop) { shop = await byDistance(lat, lng); matchedBy = "nearest shop in radius" }
  if (!shop) { shop = await byPincode(pincode);   matchedBy = "same pincode" }

  if (!shop) {
    await pool.query(`UPDATE orders SET assignment_status='unfulfilled' WHERE id=$1`, [orderId])
    return {
      assigned: false,
      locality_id: localityId,
      reason: localityId
        ? "no open shop mapped to this locality"
        : "address did not match a serviceable locality",
    }
  }

  const shopId = shop.shop_id
  await pool.query(
    `UPDATE orders SET assigned_shop_id=$1, assignment_status='assigned', status='Confirmed'
     WHERE id=$2`, [shopId, orderId])

  // Stock and capacity are bookkeeping, not gates. If either fails, the
  // order stays assigned — a shop that can see the order can deal with a
  // missing item; a shop that never receives it cannot.
  try {
    for (const it of (items || [])) {
      await pool.query(
        `UPDATE vendor_inventory
         SET stock_qty = GREATEST(0, stock_qty - $1), updated_at = NOW()
         WHERE shop_id=$2 AND product_id=$3`,
        [it.quantity || 1, shopId, it.product_id])
    }
    await pool.query(`UPDATE shops SET orders_today = orders_today + 1 WHERE id=$1`, [shopId])
  } catch (e) {
    console.log("stock update skipped for order", orderId, ":", e.message)
  }

  console.log(`[Assign] order ${orderId} -> shop ${shopId} (${matchedBy})`)
  return { assigned: true, shop_id: shopId, matched_by: matchedBy, locality_id: localityId }
}

async function reassignFailedOrder(orderId) {
  const o = await pool.query(
    `SELECT pincode, address_id, assigned_shop_id FROM orders WHERE id=$1`, [orderId])
  if (o.rows.length === 0) return { assigned: false, reason: "order not found" }

  if (o.rows[0].assigned_shop_id) {
    await pool.query(
      `UPDATE shops SET priority_score = GREATEST(0, priority_score - 10) WHERE id=$1`,
      [o.rows[0].assigned_shop_id])
  }

  const items = await pool.query(
    `SELECT product_id, quantity FROM order_items WHERE order_id=$1`, [orderId])
  return await autoAssignOrder(orderId, o.rows[0].pincode, items.rows, o.rows[0].address_id)
}

module.exports = { autoAssignOrder, reassignFailedOrder }
