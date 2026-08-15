// ────────────────────────────────────────────────────────────────────────────
// settlementService.js
//
// Restaurants earn per delivered order (restaurant_payouts). Every SETTLEMENT_DAYS
// those pending rows are grouped into one settlement, which is what actually gets
// paid out.
//
// Money movement is deliberately NOT automated here. Paying out needs RazorpayX
// or equivalent, with its own onboarding and a funded account. Until that exists,
// an admin pays by UPI and marks the settlement paid - the ledger is identical
// either way, so switching to automated later is one function, not a rebuild.
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../config/db")

async function setting(key, fallback) {
  try {
    const r = await pool.query(`SELECT value FROM food_settings WHERE key=$1`, [key])
    const n = Number(r.rows[0]?.value)
    return Number.isFinite(n) ? n : fallback
  } catch (e) { return fallback }
}

/**
 * Group every unsettled payout for a restaurant into one settlement row.
 * Idempotent: a payout already carrying a settlement_id is never picked up twice.
 */
async function settleRestaurant(restaurantId, { periodStart, periodEnd } = {}) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // lock the rows we are about to claim so two runs cannot both take them
    const rows = await client.query(
      `SELECT id, food_amount, commission_amount, payout_amount, tax_amount, created_at
       FROM restaurant_payouts
       WHERE restaurant_id = $1
         AND settlement_id IS NULL
         AND payout_status = 'pending'
       ORDER BY id
       FOR UPDATE`, [restaurantId])

    if (rows.rows.length === 0) { await client.query("ROLLBACK"); return null }

    const gross = rows.rows.reduce((a, r) => a + Number(r.food_amount || 0), 0)
    const comm  = rows.rows.reduce((a, r) => a + Number(r.commission_amount || 0), 0)
    const tax   = rows.rows.reduce((a, r) => a + Number(r.tax_amount || 0), 0)
    const net   = rows.rows.reduce((a, r) => a + Number(r.payout_amount || 0), 0)

    const dates = rows.rows.map(r => new Date(r.created_at))
    const start = periodStart || new Date(Math.min(...dates))
    const end   = periodEnd   || new Date(Math.max(...dates))
    const d = x => x.toISOString().slice(0, 10)

    const s = await client.query(
      `INSERT INTO food_settlements
         (restaurant_id, period_start, period_end, gross_amount, commission, tax_withheld, net_payable, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
       ON CONFLICT (restaurant_id, period_start, period_end) DO UPDATE
         SET gross_amount = food_settlements.gross_amount + EXCLUDED.gross_amount,
             commission   = food_settlements.commission   + EXCLUDED.commission,
             tax_withheld = food_settlements.tax_withheld + EXCLUDED.tax_withheld,
             net_payable  = food_settlements.net_payable  + EXCLUDED.net_payable
       RETURNING *`,
      [restaurantId, d(start), d(end),
       Math.round(gross * 100) / 100, Math.round(comm * 100) / 100,
       Math.round(tax * 100) / 100,  Math.round(net * 100) / 100])

    const settlement = s.rows[0]

    await client.query(
      `UPDATE restaurant_payouts SET settlement_id = $1
       WHERE id = ANY($2::int[])`,
      [settlement.id, rows.rows.map(r => r.id)])

    await client.query("COMMIT")
    console.log(`[Settlement] restaurant ${restaurantId}: ${rows.rows.length} orders, net ${net}`)
    return settlement
  } catch (e) {
    try { await client.query("ROLLBACK") } catch (_) {}
    console.log("[Settlement] error:", e.message)
    throw e
  } finally { client.release() }
}

/** Run the cycle for every restaurant with unsettled earnings. */
async function runCycle() {
  try {
    const r = await pool.query(
      `SELECT DISTINCT restaurant_id FROM restaurant_payouts
       WHERE settlement_id IS NULL AND payout_status = 'pending'`)
    let n = 0
    for (const row of r.rows) {
      try { if (await settleRestaurant(row.restaurant_id)) n++ }
      catch (e) { /* one restaurant failing must not stop the rest */ }
    }
    if (n > 0) console.log(`[Settlement] cycle complete: ${n} settlement(s) created`)
    return n
  } catch (e) {
    console.log("[Settlement] cycle error:", e.message)
    return 0
  }
}

/** Mark a settlement paid, and its payout lines with it. */
async function markPaid(settlementId, reference) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const s = await client.query(
      `UPDATE food_settlements SET status='paid', paid_at=NOW(), reference=$1
       WHERE id=$2 AND status <> 'paid' RETURNING *`, [reference || null, settlementId])
    if (s.rows.length === 0) { await client.query("ROLLBACK"); return null }

    await client.query(
      `UPDATE restaurant_payouts
       SET payout_status='paid', paid_at=NOW(), payout_reference_id=$1
       WHERE settlement_id=$2`, [reference || null, settlementId])

    await client.query("COMMIT")
    return s.rows[0]
  } catch (e) {
    try { await client.query("ROLLBACK") } catch (_) {}
    throw e
  } finally { client.release() }
}

/** Daily at 02:00 local, only acting when the cycle is due. */
function start() {
  const tick = async () => {
    const now = new Date()
    if (now.getHours() !== 2) return
    const days = await setting("SETTLEMENT_DAYS", 2)
    // day-of-year modulo the cycle length, so a 2-day cycle runs every other day
    const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000)
    if (doy % Math.max(1, days) !== 0) return
    await runCycle()
  }
  setInterval(tick, 60 * 60 * 1000)   // hourly check, acts once
  console.log("[Settlement] job registered")
}

module.exports = { settleRestaurant, runCycle, markPaid, start }
