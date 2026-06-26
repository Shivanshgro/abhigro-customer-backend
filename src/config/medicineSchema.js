const pool = require("./db")

// ─────────────────────────────────────────────────────────────────────────────
// Medicine module schema — fully separate from grocery tables.
// Idempotent (CREATE TABLE IF NOT EXISTS), safe to run on every boot.
// Note: `owner_user_id` is added to pharmacies so a pharmacy user account can
// log in and see only its own orders (not in the original spec but required
// for auth/ownership).
// ─────────────────────────────────────────────────────────────────────────────
async function ensureMedicineSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pharmacies (
        id SERIAL PRIMARY KEY,
        owner_user_id INT,
        pharmacy_name VARCHAR(200) NOT NULL,
        owner_name VARCHAR(200),
        phone VARCHAR(20),
        email VARCHAR(200),
        address TEXT,
        pincode VARCHAR(10),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        drug_license_number VARCHAR(100),
        license_expiry_date DATE,
        gst_number VARCHAR(50),
        pharmacist_name VARCHAR(200),
        pharmacist_registration_number VARCHAR(100),
        is_active BOOLEAN DEFAULT false,
        is_online BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS medicine_products (
        id SERIAL PRIMARY KEY,
        pharmacy_id INT REFERENCES pharmacies(id),
        medicine_name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        product_type VARCHAR(50) DEFAULT 'OTC',
        mrp NUMERIC(10,2) NOT NULL,
        selling_price NUMERIC(10,2) NOT NULL,
        stock INT DEFAULT 0,
        requires_prescription BOOLEAN DEFAULT false,
        image_url TEXT,
        manufacturer_name VARCHAR(200),
        batch_number VARCHAR(100),
        expiry_date DATE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS medicine_orders (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(40) UNIQUE,
        customer_id INT,
        pharmacy_id INT,
        delivery_boy_id INT,
        customer_name VARCHAR(200),
        customer_phone VARCHAR(20),
        customer_address TEXT,
        customer_pincode VARCHAR(10),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        total_medicine_amount NUMERIC(10,2) DEFAULT 0,
        delivery_fee NUMERIC(10,2) DEFAULT 0,
        platform_fee NUMERIC(10,2) DEFAULT 0,
        total_amount NUMERIC(10,2) DEFAULT 0,
        pharmacy_commission_percent NUMERIC(5,2) DEFAULT 0,
        pharmacy_commission_amount NUMERIC(10,2) DEFAULT 0,
        pharmacy_settlement_amount NUMERIC(10,2) DEFAULT 0,
        payment_method VARCHAR(20) DEFAULT 'cod',
        payment_status VARCHAR(20) DEFAULT 'pending',
        order_status VARCHAR(40) DEFAULT 'medicine_order_placed',
        prescription_url TEXT,
        prescription_status VARCHAR(40),
        prescription_rejection_reason TEXT,
        packed_photo_url TEXT,
        delivery_photo_url TEXT,
        pharmacy_invoice_url TEXT,
        abhigro_service_receipt_url TEXT,
        cod_collected_amount NUMERIC(10,2),
        requires_prescription BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS medicine_order_items (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES medicine_orders(id),
        medicine_product_id INT,
        medicine_name VARCHAR(255),
        quantity INT DEFAULT 1,
        mrp NUMERIC(10,2),
        selling_price NUMERIC(10,2),
        total_price NUMERIC(10,2),
        batch_number VARCHAR(100),
        expiry_date DATE,
        manufacturer_name VARCHAR(200)
      );

      CREATE TABLE IF NOT EXISTS medicine_order_status_history (
        id SERIAL PRIMARY KEY,
        order_id INT REFERENCES medicine_orders(id),
        status VARCHAR(40),
        changed_by_role VARCHAR(30),
        changed_by_id INT,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pharmacy_settlements (
        id SERIAL PRIMARY KEY,
        pharmacy_id INT REFERENCES pharmacies(id),
        settlement_period_start DATE,
        settlement_period_end DATE,
        total_orders INT DEFAULT 0,
        total_medicine_value NUMERIC(12,2) DEFAULT 0,
        total_commission NUMERIC(12,2) DEFAULT 0,
        subscription_fee NUMERIC(10,2) DEFAULT 0,
        gst_amount NUMERIC(10,2) DEFAULT 0,
        total_payable_to_abhigro NUMERIC(12,2) DEFAULT 0,
        total_payable_to_pharmacy NUMERIC(12,2) DEFAULT 0,
        settlement_status VARCHAR(20) DEFAULT 'pending',
        invoice_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS owner_user_id INT;
    `)
    console.log("✅ ensureMedicineSchema: medicine tables ready")
  } catch (e) {
    console.error("ensureMedicineSchema error:", e.message)
  }
}

module.exports = ensureMedicineSchema
