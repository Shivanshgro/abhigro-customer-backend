// Restaurant Food Delivery — idempotent schema (5 tables). Additive, safe on boot.
// Separate from grocery/medicine/assisted-food. Nothing existing is altered.
const pool = require("./db")

async function ensureRestaurantSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS food_restaurants (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER NOT NULL,
        restaurant_name TEXT NOT NULL,
        owner_name TEXT,
        phone TEXT,
        email TEXT,
        address TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        pincode TEXT,
        fssai_number TEXT,
        fssai_certificate TEXT,
        pan_number TEXT,
        gst_number TEXT,
        bank_account_details TEXT,
        upi_id TEXT,
        restaurant_images TEXT,
        menu_images TEXT,
        opening_time TEXT,
        closing_time TEXT,
        food_type TEXT,
        cuisine_type TEXT,
        commission_percent NUMERIC DEFAULT 10,
        is_online BOOLEAN DEFAULT false,
        is_approved BOOLEAN DEFAULT false,
        approval_status TEXT DEFAULT 'pending',
        rating NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_food_rest_owner ON food_restaurants(owner_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_food_rest_pincode ON food_restaurants(pincode)`)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS food_categories (
        id SERIAL PRIMARY KEY,
        restaurant_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_food_cat_rest ON food_categories(restaurant_id)`)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS food_items (
        id SERIAL PRIMARY KEY,
        restaurant_id INTEGER NOT NULL,
        category_id INTEGER,
        name TEXT NOT NULL,
        description TEXT,
        price NUMERIC NOT NULL,
        image TEXT,
        food_type TEXT,
        preparation_time INTEGER,
        is_available BOOLEAN DEFAULT true,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_food_item_rest ON food_items(restaurant_id)`)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS food_orders (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL,
        restaurant_id INTEGER NOT NULL,
        delivery_partner_id INTEGER,
        items JSONB,
        food_amount NUMERIC DEFAULT 0,
        platform_fee NUMERIC DEFAULT 0,
        delivery_fee NUMERIC DEFAULT 0,
        tax_amount NUMERIC DEFAULT 0,
        total_amount NUMERIC DEFAULT 0,
        payment_status TEXT DEFAULT 'pending',
        payment_id TEXT,
        razorpay_order_id TEXT,
        order_status TEXT DEFAULT 'placed',
        delivery_address TEXT,
        delivery_latitude DOUBLE PRECISION,
        delivery_longitude DOUBLE PRECISION,
        delivery_phone TEXT,
        restaurant_accept_status TEXT DEFAULT 'pending',
        cancellation_reason TEXT,
        refund_status TEXT,
        accepted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_food_order_cust ON food_orders(customer_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_food_order_rest ON food_orders(restaurant_id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_food_order_partner ON food_orders(delivery_partner_id)`)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS restaurant_payouts (
        id SERIAL PRIMARY KEY,
        restaurant_id INTEGER NOT NULL,
        order_id INTEGER NOT NULL,
        food_amount NUMERIC,
        commission_amount NUMERIC,
        payout_amount NUMERIC,
        payout_status TEXT DEFAULT 'pending',
        payout_reference_id TEXT,
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rest_payout_rest ON restaurant_payouts(restaurant_id)`)

    // food ratings/complaints (Phase D)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS food_reviews (
        id SERIAL PRIMARY KEY,
        order_id INTEGER,
        restaurant_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        rating INTEGER CHECK (rating BETWEEN 1 AND 5),
        comment TEXT,
        complaint TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )`)

    // settings seeds
    await pool.query(`
      INSERT INTO app_settings(key,value) VALUES
        ('food_platform_fee','10'),
        ('food_delivery_fee','30'),
        ('food_tax_percent','5'),
        ('food_default_commission','10'),
        ('food_accept_timeout_sec','120')
      ON CONFLICT (key) DO NOTHING`)

    console.log("✓ restaurant food schema ensured")
  } catch (e) { console.log("ensureRestaurantSchema error:", e.message) }
}
module.exports = ensureRestaurantSchema
