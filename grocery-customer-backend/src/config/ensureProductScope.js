const pool = require("../config/db")

// Adds hybrid location-scope columns to products.
// availability_scope: 'global' | 'state' | 'city' | 'pincode'  (default global)
// scope_value: the matching value (e.g. 'Karnataka', 'Bangalore', '560001'); NULL for global
async function ensureProductScope() {
  try {
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS availability_scope VARCHAR(20) DEFAULT 'global'`)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS scope_value VARCHAR(100)`)
    // backfill any nulls to global so nothing is hidden
    await pool.query(`UPDATE products SET availability_scope='global' WHERE availability_scope IS NULL`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_scope ON products(availability_scope, scope_value)`)
    console.log("✓ product scope columns ready")
  } catch (e) {
    console.log("ensureProductScope error:", e.message)
  }
}
module.exports = ensureProductScope
