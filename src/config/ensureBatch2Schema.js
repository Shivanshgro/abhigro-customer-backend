// Batch 2 schema — reviews, wallet, referrals, cancellation. Idempotent & safe.
const pool = require("./db")

async function ensureBatch2Schema() {
  try {
    // ---- Reviews ----
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_reviews (
        id          SERIAL PRIMARY KEY,
        product_id  INTEGER NOT NULL,
        user_id     INTEGER NOT NULL,
        order_id    INTEGER,
        rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment     TEXT,
        verified    BOOLEAN DEFAULT false,
        created_at  TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id)`)
    // one review per user per product (re-reviewing updates)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_review_user_product ON product_reviews(user_id, product_id)`)

    // ---- Wallet: balance on users + ledger ----
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC DEFAULT 0`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL,
        amount      NUMERIC NOT NULL,            -- +credit / -debit
        type        TEXT NOT NULL,               -- refund, referral_bonus, signup_bonus, spend, adjust
        reference   TEXT,                        -- e.g. order:123
        balance_after NUMERIC,
        created_at  TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id)`)

    // backfill referral codes for existing users that lack one
    await pool.query(`
      UPDATE users SET referral_code = UPPER(SUBSTRING(MD5(id::text || phone) FROM 1 FOR 6))
      WHERE referral_code IS NULL`)

    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee NUMERIC DEFAULT 0`)

    // ---- Cancellation columns on orders ----
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP`)
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT`)
    await pool.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT false`)

    // ---- Referral settings (seed) ----
    await pool.query(`
      INSERT INTO app_settings(key, value) VALUES
        ('referral_referrer_bonus','50'),
        ('referral_referee_bonus','50'),
        ('signup_bonus','0')
      ON CONFLICT (key) DO NOTHING`)

    console.log("✓ batch2 schema ensured")
  } catch (e) {
    console.log("ensureBatch2Schema error:", e.message)
  }
}
module.exports = ensureBatch2Schema
