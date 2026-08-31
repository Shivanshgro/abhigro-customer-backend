const cron = require("node-cron")
const { generateAll } = require("../services/merchantPayouts")

/* ═══════════════════════════════════════════════════════════════════════
   Weekly merchant settlement.

   Runs Monday at 02:00 IST and settles the week that just ended, so a
   merchant opening their panel on Monday morning sees a closed statement
   rather than a period still moving.

   generatePayout is idempotent: a UNIQUE index on the period and another
   on the order line means a re-run cannot pay anyone twice. That matters
   because Azure restarts the process more often than you would think.
   ═══════════════════════════════════════════════════════════════════════ */

module.exports = function startMerchantPayoutJob() {
  try {
    // Monday 02:00, Asia/Kolkata.
    cron.schedule("0 2 * * 1", async () => {
      try {
        const r = await generateAll()
        console.log(`[Payouts] ${r.period.start} to ${r.period.end} — ` +
          `${r.shops} shops, ${r.pharmacies} pharmacies, ₹${r.total}`)
      } catch (e) {
        console.log("[Payouts] run failed:", e.message)
      }
    }, { timezone: "Asia/Kolkata" })

    console.log("[Payouts] Weekly merchant settlement scheduled ✅")
  } catch (e) {
    console.log("WARN merchantPayoutJob:", e.message)
  }
}
