const pool = require("./db")

// ─────────────────────────────────────────────────────────────────────────────
// Idempotent schema bootstrap.
// Adds the columns the delivery-boy / payment flow needs WITHOUT touching any
// existing column or data. Safe to run on every boot (uses IF NOT EXISTS).
// This is what lets us add the new flow without a manual DB migration.
// ─────────────────────────────────────────────────────────────────────────────
async function ensureSchema() {
  try {
    await pool.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_boy_id   INT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status     VARCHAR(20);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS packed_photo       TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_photo     TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_collected     BOOLEAN DEFAULT false;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at       TIMESTAMP;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at       TIMESTAMP;
    `)

    // Backfill payment_status for rows created before this column existed.
    // COD => Pending (or Collected if already completed); online => Paid.
    await pool.query(`
      UPDATE orders SET payment_status = CASE
        WHEN status = 'Completed' AND payment_method ILIKE 'cod' THEN 'Collected'
        WHEN payment_method ILIKE 'cod' THEN 'Pending'
        ELSE 'Paid'
      END
      WHERE payment_status IS NULL;
    `)

    console.log("✅ ensureSchema: delivery/payment columns ready")
  } catch (e) {
    // Never crash the server because of schema bootstrap — just log it.
    console.error("ensureSchema error:", e.message)
  }
}

module.exports = ensureSchema
