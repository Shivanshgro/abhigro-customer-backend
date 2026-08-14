// ────────────────────────────────────────────────────────────────────────────
// foodAutoReject.js
//
// A customer should not wait indefinitely on a kitchen that never answers.
// After AUTO_REJECT_AFTER_MIN with no response, the order is cancelled and
// flagged for refund.
//
// This runs on the server, not in the browser: a restaurant closing their
// laptop must not stop it firing.
//
// Uses the state machine, so the cancellation is validated and audited like
// any other transition.
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../config/db")
const { transition } = require("./foodOrderState")

async function setting(key, fallback) {
  try {
    const r = await pool.query(`SELECT value FROM food_settings WHERE key=$1`, [key])
    const n = Number(r.rows[0]?.value)
    return Number.isFinite(n) ? n : fallback
  } catch (e) { return fallback }
}

async function sweep() {
  try {
    const mins = await setting("AUTO_REJECT_AFTER_MIN", 10)
    const stale = await pool.query(
      `SELECT id FROM food_orders
       WHERE order_status = 'restaurant_pending'
         AND created_at < NOW() - ($1 || ' minutes')::interval
       LIMIT 50`, [String(mins)])

    for (const row of stale.rows) {
      try {
        await transition({
          orderId: row.id,
          to: "cancelled",
          actorType: "system",
          actorId: null,
          set: {
            cancellation_reason: `No response from the restaurant within ${mins} minutes`,
            refund_status: "pending",
          },
          note: "Auto-cancelled",
        })
        console.log(`[FoodAutoReject] order ${row.id} cancelled after ${mins} min`)
      } catch (e) {
        // an order that moved on between the query and the transition is fine
        console.log(`[FoodAutoReject] skipped ${row.id}: ${e.message}`)
      }
    }
  } catch (e) {
    console.log("[FoodAutoReject] sweep error:", e.message)
  }
}

function start() {
  // every minute; the query is indexed and bounded to 50 rows
  setInterval(sweep, 60 * 1000)
  console.log("[FoodAutoReject] job registered")
}

module.exports = { start, sweep }
