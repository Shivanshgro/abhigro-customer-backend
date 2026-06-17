const cron = require("node-cron")
const pool = require("../config/db")

// Reset each vendor's daily order count at midnight
cron.schedule("0 0 * * *", async () => {
  try {
    await pool.query(`UPDATE shops SET orders_today = 0`)
    console.log("[DailyReset] Vendor daily order counts reset")
  } catch (e) { console.error("[DailyReset] error:", e.message) }
})
console.log("[DailyReset] Daily vendor reset job registered ✅")
