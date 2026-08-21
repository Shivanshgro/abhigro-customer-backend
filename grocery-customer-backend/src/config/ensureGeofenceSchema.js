// Idempotent, non-destructive. Mirrors ensureTrackingSchema pattern.
// Adds: address coordinates, per-order geofence override, arrival timestamp,
// and the tunable geofence settings. Safe to run on every boot.
const pool = require("./db")

async function ensureGeofenceSchema() {
  try {
    // --- Address coordinates (read by createOrder/getQuote/getTracking, never written until now) ---
    await pool.query(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION`)
    await pool.query(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`)
    await pool.query(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS label     TEXT`)
    await pool.query(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS state     TEXT`)
    await pool.query(`ALTER TABLE addresses ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false`)

    // --- Geofence bookkeeping on orders ---
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMP`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_distance_m INTEGER`)

    // --- Tunable settings (same app_settings table as delivery fee) ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      )`)
    await pool.query(`
      INSERT INTO app_settings(key, value) VALUES
        ('delivery_geofence_meters','100'),
        ('geofence_max_location_age_sec','180'),
        ('geofence_enforce','1')
      ON CONFLICT (key) DO NOTHING`)

    console.log("✓ geofence/address schema ensured")
  } catch (e) {
    console.log("ensureGeofenceSchema error:", e.message)
  }
}

module.exports = ensureGeofenceSchema
