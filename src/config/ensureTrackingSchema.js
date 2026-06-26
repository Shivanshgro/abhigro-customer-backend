// Idempotent, non-destructive. Adds tracking columns + tables + settings.
// Mirrors the project's existing ensureSchema pattern. Safe to run on every boot.
const pool = require("./db")

async function ensureTrackingSchema() {
  try {
    // Location columns on orders (delivery_boy_id already exists)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_latitude  DOUBLE PRECISION`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_longitude DOUBLE PRECISION`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_latitude    DOUBLE PRECISION`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_longitude   DOUBLE PRECISION`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_delivery_time INTEGER`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC DEFAULT 0`)

    // Latest delivery-partner location per active order
    await pool.query(`
      CREATE TABLE IF NOT EXISTS delivery_partner_locations (
        id              SERIAL PRIMARY KEY,
        order_id        INTEGER NOT NULL,
        delivery_boy_id INTEGER,
        latitude        DOUBLE PRECISION NOT NULL,
        longitude       DOUBLE PRECISION NOT NULL,
        heading         DOUBLE PRECISION,
        speed           DOUBLE PRECISION,
        updated_at      TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_dpl_order ON delivery_partner_locations(order_id)`)

    // Key-value settings (delivery fee params, surge, COD toggle, etc.)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      )`)
    // Seed sensible defaults only if missing
    await pool.query(`
      INSERT INTO app_settings(key, value) VALUES
        ('delivery_base_fee','20'),
        ('delivery_per_km','7'),
        ('delivery_free_above_km','0'),
        ('delivery_min_fee','0'),
        ('delivery_max_fee','80'),
        ('delivery_surge','1'),
        ('free_delivery_above_order','299')
      ON CONFLICT (key) DO NOTHING`)

    console.log("✓ tracking/settings schema ensured")
  } catch (e) {
    console.log("ensureTrackingSchema error:", e.message)
  }
}

module.exports = ensureTrackingSchema
