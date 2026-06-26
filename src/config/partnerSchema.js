const pool = require("./db")

// Idempotent schema for vendor + delivery partner onboarding.
async function ensurePartnerSchema() {
  try {
    await pool.query(`
      -- Vendor / supplier fields on the existing shops table
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS owner_name VARCHAR(200);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS email VARCHAR(200);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS city VARCHAR(120);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS state VARCHAR(120);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS vendor_type VARCHAR(80);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS categories TEXT;
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS gst_number VARCHAR(50);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS fssai_number VARCHAR(50);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS open_time VARCHAR(20);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS close_time VARCHAR(20);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS service_pincodes TEXT;
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS shop_photo TEXT;
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS license_url TEXT;
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS account_holder VARCHAR(200);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS account_number VARCHAR(40);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS ifsc VARCHAR(20);
      ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

      -- Delivery partners
      CREATE TABLE IF NOT EXISTS delivery_partners (
        id SERIAL PRIMARY KEY,
        user_id INT,
        full_name VARCHAR(200) NOT NULL,
        phone VARCHAR(20),
        email VARCHAR(200),
        address TEXT,
        pincode VARCHAR(10),
        city VARCHAR(120),
        vehicle_type VARCHAR(40),
        vehicle_number VARCHAR(40),
        license_url TEXT,
        id_proof_url TEXT,
        photo_url TEXT,
        emergency_contact VARCHAR(20),
        account_holder VARCHAR(200),
        account_number VARCHAR(40),
        ifsc VARCHAR(20),
        work_pincode VARCHAR(10),
        is_approved BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `)
    console.log("✅ ensurePartnerSchema: vendor + delivery onboarding ready")
  } catch (e) {
    console.error("ensurePartnerSchema error:", e.message)
  }
}

module.exports = ensurePartnerSchema