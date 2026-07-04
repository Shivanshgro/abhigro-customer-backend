const pool = require("../config/db")

// Phase 1: brands + subcategories tables, product columns, and seed the
// category -> subcategory -> brand reference structure.
async function ensureBrandSubcategory() {
  try {
    // 1) brands
    await pool.query(`
      CREATE TABLE IF NOT EXISTS brands (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) UNIQUE NOT NULL,
        logo TEXT,
        is_local BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )`)

    // 2) subcategories (linked to categories)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subcategories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        requires_brand BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (name, category_id)
      )`)

    // 3) product columns (brand optional, subcategory link)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(id)`)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory_id INTEGER REFERENCES subcategories(id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_subcat ON products(subcategory_id)`)

    console.log("✓ brands + subcategories schema ready")
  } catch (e) {
    console.log("ensureBrandSubcategory error:", e.message)
  }
}
module.exports = ensureBrandSubcategory
