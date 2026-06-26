const cron = require("node-cron")
const pool = require("../config/db")

// ── Auto Stock Sync Job ──────────────────────────────────────────────────────
// Runs every hour
// 1. Marks products as out-of-stock when stock = 0
// 2. Marks products as in-stock when stock > 0
// 3. Logs summary
// ─────────────────────────────────────────────────────────────────────────────

async function runStockSync() {
  try {
    // Mark out of stock
    const outResult = await pool.query(
      `UPDATE products SET is_active = false, updated_at = NOW()
       WHERE stock = 0 AND is_active = true
       RETURNING id, name`
    )

    // Mark back in stock
    const inResult = await pool.query(
      `UPDATE products SET is_active = true, updated_at = NOW()
       WHERE stock > 0 AND is_active = false
       RETURNING id, name`
    )

    if (outResult.rows.length > 0 || inResult.rows.length > 0) {
      console.log(`[StockSync ${new Date().toISOString()}]`)
      console.log(`  ❌ Marked out of stock: ${outResult.rows.length} products`)
      console.log(`  ✅ Marked back in stock: ${inResult.rows.length} products`)
      if (outResult.rows.length > 0)
        console.log("  Out of stock:", outResult.rows.map(r => r.name).join(", "))
      if (inResult.rows.length > 0)
        console.log("  Back in stock:", inResult.rows.map(r => r.name).join(", "))
    }
  } catch (error) {
    console.error("[StockSync] Error:", error.message)
  }
}

// Run every hour at :00
cron.schedule("0 * * * *", () => {
  console.log("[StockSync] Running hourly stock check...")
  runStockSync()
})

// Also run once on server start
runStockSync()

console.log("[StockSync] Hourly stock sync job registered ✅")
module.exports = { runStockSync }
