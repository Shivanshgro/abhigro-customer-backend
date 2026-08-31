const pool = require("../config/db")

/* ═══════════════════════════════════════════════════════════════════════
   Merchant settlements — grocery shops and pharmacies.

   Deliberately mirrors partner_payouts (riders) rather than inventing a
   second shape, so both sides of the marketplace settle the same way and
   the numbers can be reconciled against each other.

   One table serves both merchant types. Two tables would drift apart
   within a month, and a pharmacy settlement is not commercially different
   from a grocery one — only the commission rate differs.

   Additive and idempotent. Safe to run on every boot.
   ═══════════════════════════════════════════════════════════════════════ */

module.exports = async function ensureMerchantPayoutSchema() {
  try {
    // ── the settlement itself ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merchant_payouts (
        id             SERIAL PRIMARY KEY,
        merchant_type  TEXT NOT NULL,           -- 'shop' | 'pharmacy'
        merchant_id    INTEGER NOT NULL,        -- shops.id or pharmacies.id
        period_start   DATE NOT NULL,
        period_end     DATE NOT NULL,
        orders_count   INTEGER DEFAULT 0,
        gross_amount   NUMERIC(12,2) DEFAULT 0, -- what customers paid for goods
        commission_pct NUMERIC(5,2)  DEFAULT 0, -- rate applied, stored so history
                                                -- stays correct if the rate changes
        commission     NUMERIC(12,2) DEFAULT 0,
        refunds        NUMERIC(12,2) DEFAULT 0, -- cancelled or refunded after delivery
        adjustments    NUMERIC(12,2) DEFAULT 0, -- manual credits or debits
        net_amount     NUMERIC(12,2) DEFAULT 0, -- what we actually owe them
        status         TEXT DEFAULT 'pending',  -- pending | processing | paid | failed
        reference      TEXT,                    -- bank UTR once paid
        note           TEXT,
        created_at     TIMESTAMP DEFAULT NOW(),
        paid_at        TIMESTAMP
      )`)

    // One settlement per merchant per period. Without this a re-run of the
    // weekly job would pay someone twice.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_payout_period
      ON merchant_payouts (merchant_type, merchant_id, period_start, period_end)`)

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_merchant_payout_lookup
      ON merchant_payouts (merchant_type, merchant_id, created_at DESC)`)

    // ── the orders behind it ──
    // A merchant who disputes a figure needs to see which orders made it up.
    // A single total with no breakdown is the fastest way to lose their trust.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merchant_payout_orders (
        id          SERIAL PRIMARY KEY,
        payout_id   INTEGER NOT NULL,
        order_id    INTEGER NOT NULL,
        order_type  TEXT DEFAULT 'grocery',     -- 'grocery' | 'medicine'
        gross       NUMERIC(12,2) DEFAULT 0,
        commission  NUMERIC(12,2) DEFAULT 0,
        net         NUMERIC(12,2) DEFAULT 0,
        created_at  TIMESTAMP DEFAULT NOW()
      )`)

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_order
      ON merchant_payout_orders (payout_id, order_id, order_type)`)

    // Which payout an order landed in, so an order is never settled twice
    // even if periods are regenerated.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_payout_order_lookup
      ON merchant_payout_orders (order_type, order_id)`)

    // ── settings, so finance can change rates without a deploy ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      )`)

    await pool.query(`
      INSERT INTO app_settings (key, value) VALUES
        ('vendor_commission_pct',   '10'),
        ('pharmacy_commission_pct', '8'),
        ('payout_day',              '1')   -- 1 = Monday
      ON CONFLICT (key) DO NOTHING`)

    console.log("✓ merchant payout schema ensured")
  } catch (e) {
    console.log("WARN ensureMerchantPayoutSchema:", e.message)
  }
}
