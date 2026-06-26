// Assisted Food Pickup — idempotent schema. Additive, safe on every boot.
const pool = require("./db")

async function ensureAssistedFoodSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS assisted_food_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        delivery_boy_id INTEGER,
        shop_name TEXT NOT NULL,
        pickup_location TEXT,
        pickup_lat DOUBLE PRECISION,
        pickup_lng DOUBLE PRECISION,
        food_item TEXT,
        quantity TEXT,
        special_instructions TEXT,
        estimated_food_amount NUMERIC DEFAULT 0,
        actual_food_amount NUMERIC,
        platform_fee NUMERIC DEFAULT 0,
        delivery_fee NUMERIC DEFAULT 0,
        customer_food_payment_status TEXT DEFAULT 'pending',
        customer_payment_link_id TEXT,
        customer_payment_id TEXT,
        vendor_qr_image TEXT,
        vendor_upi_id TEXT,
        vendor_payment_status TEXT DEFAULT 'pending',
        vendor_payment_reference_id TEXT,
        vendor_payment_proof_image TEXT,
        price_confirmed_by_partner BOOLEAN DEFAULT false,
        price_confirmed_at TIMESTAMP,
        vendor_paid_at TIMESTAMP,
        pickup_proof_image TEXT,
        delivery_proof_image TEXT,
        status TEXT DEFAULT 'platform_paid',
        cancellation_reason TEXT,
        refund_status TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_af_user ON assisted_food_orders(user_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_af_partner ON assisted_food_orders(delivery_boy_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_af_status ON assisted_food_orders(status)`)

    // seed assisted-food fee settings (tunable via app_settings)
    await pool.query(`
      INSERT INTO app_settings(key,value) VALUES
        ('assisted_platform_fee','15'),
        ('assisted_delivery_fee','30')
      ON CONFLICT (key) DO NOTHING`)

    console.log("✓ assisted food schema ensured")
  } catch (e) { console.log("ensureAssistedFoodSchema error:", e.message) }
}
module.exports = ensureAssistedFoodSchema
