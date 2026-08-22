// Partner earnings engine.
//
// SAFETY CONTRACT: recordOrderEarning() is called from markDelivered but it
// NEVER throws into that flow and NEVER changes its result. If anything here
// fails, the delivery still completes. Earnings are a side-ledger, not a
// precondition. This is why every call site wraps it in try/catch and why the
// function itself catches internally as well.
const pool = require("../config/db")
const { distanceKm } = require("../utils/distance")

const DEFAULTS = {
  partner_base_pay: 25,
  partner_per_km: 6,
  partner_min_pay: 25,
  partner_max_pay: 200,
  partner_free_km: 1,
  partner_rain_surge: 15,
  partner_peak_surge: 20,
  partner_rain_active: 0,
}

async function getPartnerRates() {
  try {
    const r = await pool.query(
      `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
      [Object.keys(DEFAULTS)])
    const out = { ...DEFAULTS }
    for (const row of r.rows) {
      const n = Number(row.value)
      if (!isNaN(n)) out[row.key] = n
    }
    return out
  } catch { return { ...DEFAULTS } }
}

// Active base rate card overrides app_settings when present.
async function getActiveBaseCard(city) {
  try {
    const r = await pool.query(
      `SELECT id, config FROM partner_rate_cards
       WHERE kind='base' AND is_active=true
         AND (city IS NULL OR city=$1)
         AND (active_from IS NULL OR active_from <= NOW())
         AND (active_to   IS NULL OR active_to   >= NOW())
       ORDER BY city NULLS LAST, id DESC LIMIT 1`, [city || null])
    return r.rows[0] || null
  } catch { return null }
}

// Is this moment inside a peak slot template?
async function isPeakNow(city) {
  try {
    const r = await pool.query(
      `SELECT 1 FROM partner_slot_templates
       WHERE is_active=true AND is_peak=true
         AND (city IS NULL OR city=$1)
         AND (day_of_week IS NULL OR day_of_week = EXTRACT(DOW FROM NOW())::int)
         AND CURRENT_TIME BETWEEN start_time AND end_time
       LIMIT 1`, [city || null])
    return r.rows.length > 0
  } catch { return false }
}

/**
 * Compute what a partner earns for one delivered order.
 * Pure-ish: reads config, does the maths, returns a breakdown. No writes.
 */
async function computeEarning({ orderId, city }) {
  const s = await getPartnerRates()
  const card = await getActiveBaseCard(city)
  const cfg = card?.config || {}

  const basePay = Number(cfg.base_pay ?? s.partner_base_pay)
  const perKm   = Number(cfg.per_km   ?? s.partner_per_km)
  const freeKm  = Number(cfg.free_km  ?? s.partner_free_km)
  const minPay  = Number(cfg.min_pay  ?? s.partner_min_pay)
  const maxPay  = Number(cfg.max_pay  ?? s.partner_max_pay)

  // Distance: shop -> customer, using the order's own snapshot coordinates.
  let km = 0
  try {
    const q = await pool.query(
      `SELECT COALESCE(o.customer_latitude,  a.latitude)  AS clat,
              COALESCE(o.customer_longitude, a.longitude) AS clng,
              COALESCE(o.vendor_latitude,  NULLIF(s.latitude,'')::double precision)  AS slat,
              COALESCE(o.vendor_longitude, NULLIF(s.longitude,'')::double precision) AS slng
       FROM orders o
       LEFT JOIN shops s ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       WHERE o.id=$1`, [orderId])
    const d = q.rows[0]
    if (d) {
      const val = distanceKm(d.slat, d.slng, d.clat, d.clng)
      if (val != null && !isNaN(val)) km = Number(val)
    }
  } catch (e) { console.log("earning distance error:", e.message) }

  const billableKm  = Math.max(0, km - freeKm)
  const distancePay = Math.round(billableKm * perKm * 100) / 100

  // Surge
  let surgePay = 0, surgeReason = null
  if (Number(s.partner_rain_active) === 1) {
    surgePay += Number(s.partner_rain_surge)
    surgeReason = "rain"
  }
  if (await isPeakNow(city)) {
    surgePay += Number(s.partner_peak_surge)
    surgeReason = surgeReason ? "rain+peak" : "peak"
  }

  let total = basePay + distancePay + surgePay
  total = Math.max(minPay, Math.min(maxPay, total))
  total = Math.round(total * 100) / 100

  return {
    base_pay: basePay,
    distance_km: Math.round(km * 100) / 100,
    distance_pay: distancePay,
    surge_pay: surgePay,
    surge_reason: surgeReason,
    incentive_pay: 0,     // credited separately when a target completes
    bonus_pay: 0,
    total_pay: total,
    rate_card_id: card?.id || null,
  }
}

/**
 * Write the earning for a delivered order. Idempotent via the UNIQUE
 * constraint on order_id — calling twice cannot double-pay.
 * Never throws.
 */
async function recordOrderEarning(orderId, partnerId, vertical = "grocery") {
  try {
    if (!orderId || !partnerId) return null

    const exists = await pool.query(
      `SELECT id FROM partner_earnings WHERE order_id=$1`, [orderId])
    if (exists.rows.length > 0) return exists.rows[0]

    const cityRow = await pool.query(
      `SELECT a.city FROM orders o LEFT JOIN addresses a ON a.id=o.address_id WHERE o.id=$1`,
      [orderId])
    const city = cityRow.rows[0]?.city || null

    const e = await computeEarning({ orderId, city })

    const ins = await pool.query(
      `INSERT INTO partner_earnings
        (order_id, partner_id, vertical, base_pay, distance_km, distance_pay,
         surge_pay, surge_reason, incentive_pay, bonus_pay, total_pay, rate_card_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING *`,
      [orderId, partnerId, vertical, e.base_pay, e.distance_km, e.distance_pay,
       e.surge_pay, e.surge_reason, e.incentive_pay, e.bonus_pay, e.total_pay, e.rate_card_id])

    // Advance any incentive the partner is working toward.
    try { await advanceIncentives(partnerId, city) } catch (er) { console.log("incentive:", er.message) }

    return ins.rows[0] || null
  } catch (e) {
    console.log("recordOrderEarning error:", e.message)
    return null
  }
}

// Increment progress on every active incentive; credit when the target is hit.
async function advanceIncentives(partnerId, city) {
  const act = await pool.query(
    `SELECT id, target_orders, extra_amount FROM partner_incentives
     WHERE is_active=true
       AND (city IS NULL OR city=$1)
       AND (window_start IS NULL OR window_start <= NOW())
       AND (window_end   IS NULL OR window_end   >= NOW())`, [city || null])

  for (const inc of act.rows) {
    const up = await pool.query(
      `INSERT INTO partner_incentive_progress(partner_id, incentive_id, completed)
       VALUES($1,$2,1)
       ON CONFLICT (partner_id, incentive_id)
       DO UPDATE SET completed = partner_incentive_progress.completed + 1
       RETURNING completed, achieved_at`,
      [partnerId, inc.id])

    const row = up.rows[0]
    if (row && !row.achieved_at && row.completed >= inc.target_orders) {
      await pool.query(
        `UPDATE partner_incentive_progress SET achieved_at=NOW()
         WHERE partner_id=$1 AND incentive_id=$2 AND achieved_at IS NULL`,
        [partnerId, inc.id])
      // Credit the incentive as its own ledger row (order_id NULL).
      await pool.query(
        `INSERT INTO partner_earnings
           (partner_id, vertical, incentive_pay, total_pay, surge_reason)
         VALUES($1,'incentive',$2,$2,$3)`,
        [partnerId, inc.extra_amount, `incentive:${inc.id}`])
    }
  }
}

module.exports = {
  getPartnerRates,
  computeEarning,
  recordOrderEarning,
  advanceIncentives,
}
