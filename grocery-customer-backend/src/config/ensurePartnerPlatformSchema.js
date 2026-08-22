// Partner platform schema — earnings, rate cards, incentives, slots,
// referrals, payouts, invoices.
//
// DESIGN RULES FOLLOWED HERE:
//  - Touches NOTHING in orders / order_items / addresses / delivery_partner_locations.
//  - No duplicate order or delivery system. Every table references orders(id)
//    or users(id) and stores only the money/scheduling layer that does not exist yet.
//  - Reuses app_settings for tunables and wallet_transactions for payout balance.
//  - Idempotent: safe to run on every boot, same pattern as ensureTrackingSchema.
const pool = require("./db")

async function ensurePartnerPlatformSchema() {
  try {
    // ── 1. EARNINGS LEDGER ────────────────────────────────────────────────
    // One row per delivered order. The breakdown columns are why this is a
    // table rather than wallet_transactions rows: the partner app must show
    // base / distance / surge / incentive separately.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_earnings (
        id            SERIAL PRIMARY KEY,
        order_id      INTEGER UNIQUE,          -- UNIQUE = idempotent, cannot double-pay
        partner_id    INTEGER NOT NULL,
        vertical      TEXT DEFAULT 'grocery',  -- grocery | food | medicine
        base_pay      NUMERIC(10,2) DEFAULT 0,
        distance_km   NUMERIC(6,2)  DEFAULT 0,
        distance_pay  NUMERIC(10,2) DEFAULT 0,
        surge_pay     NUMERIC(10,2) DEFAULT 0,
        surge_reason  TEXT,                    -- rain | peak | flat | null
        incentive_pay NUMERIC(10,2) DEFAULT 0,
        bonus_pay     NUMERIC(10,2) DEFAULT 0,
        total_pay     NUMERIC(10,2) DEFAULT 0,
        slot_id       INTEGER,
        rate_card_id  INTEGER,
        earned_at     TIMESTAMP DEFAULT NOW(),
        payout_id     INTEGER                  -- set when included in a payout
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pe_partner_date ON partner_earnings(partner_id, earned_at)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pe_payout ON partner_earnings(payout_id)`)

    // ── 2. RATE CARDS ─────────────────────────────────────────────────────
    // kind: base | rain_surge | peak_surge | min_guarantee | flat_pay
    // config JSONB keeps this admin-editable without migrations.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_rate_cards (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        kind        TEXT NOT NULL,
        city        TEXT,
        vertical    TEXT DEFAULT 'grocery',
        config      JSONB NOT NULL DEFAULT '{}',
        active_from TIMESTAMP,
        active_to   TIMESTAMP,
        is_active   BOOLEAN DEFAULT true,
        created_at  TIMESTAMP DEFAULT NOW()
      )`)

    // ── 3. INCENTIVES ─────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_incentives (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        description   TEXT,
        target_orders INTEGER NOT NULL,
        extra_amount  NUMERIC(10,2) NOT NULL,
        window_start  TIMESTAMP,
        window_end    TIMESTAMP,
        city          TEXT,
        conditions    JSONB DEFAULT '{}',
        is_active     BOOLEAN DEFAULT true,
        created_at    TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_incentive_progress (
        id           SERIAL PRIMARY KEY,
        partner_id   INTEGER NOT NULL,
        incentive_id INTEGER NOT NULL,
        completed    INTEGER DEFAULT 0,
        achieved_at  TIMESTAMP,
        paid_at      TIMESTAMP,
        UNIQUE(partner_id, incentive_id)
      )`)

    // ── 4. SLOTS ──────────────────────────────────────────────────────────
    // Templates repeat weekly; bookings are per date.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_slot_templates (
        id          SERIAL PRIMARY KEY,
        label       TEXT,
        start_time  TIME NOT NULL,
        end_time    TIME NOT NULL,
        day_of_week INTEGER,             -- 0=Sun..6=Sat, NULL = every day
        city        TEXT,
        capacity    INTEGER DEFAULT 10,
        is_peak     BOOLEAN DEFAULT false,
        is_quick    BOOLEAN DEFAULT false,
        break_mins  INTEGER DEFAULT 0,
        is_active   BOOLEAN DEFAULT true
      )`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_slot_bookings (
        id          SERIAL PRIMARY KEY,
        partner_id  INTEGER NOT NULL,
        template_id INTEGER NOT NULL,
        slot_date   DATE NOT NULL,
        status      TEXT DEFAULT 'booked',  -- booked | cancelled | completed | missed
        booked_at   TIMESTAMP DEFAULT NOW(),
        started_at  TIMESTAMP,
        ended_at    TIMESTAMP,
        UNIQUE(partner_id, template_id, slot_date)
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_psb_date ON partner_slot_bookings(slot_date, template_id)`)

    // ── 5. REFERRALS ──────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_referrals (
        id            SERIAL PRIMARY KEY,
        referrer_id   INTEGER NOT NULL,
        friend_name   TEXT,
        friend_phone  TEXT,
        work_city     TEXT,
        referred_user_id INTEGER,
        status        TEXT DEFAULT 'invited',  -- invited | joined | first_order | paid | expired
        reward_amount NUMERIC(10,2) DEFAULT 0,
        created_at    TIMESTAMP DEFAULT NOW(),
        joined_at     TIMESTAMP,
        paid_at       TIMESTAMP
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pr_referrer ON partner_referrals(referrer_id)`)

    // ── 6. PAYOUTS ────────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_payouts (
        id           SERIAL PRIMARY KEY,
        partner_id   INTEGER NOT NULL,
        period_start DATE,
        period_end   DATE,
        orders_count INTEGER DEFAULT 0,
        gross_amount NUMERIC(10,2) DEFAULT 0,
        deductions   NUMERIC(10,2) DEFAULT 0,
        net_amount   NUMERIC(10,2) DEFAULT 0,
        status       TEXT DEFAULT 'pending',  -- pending | processing | paid | failed
        reference    TEXT,
        created_at   TIMESTAMP DEFAULT NOW(),
        paid_at      TIMESTAMP
      )`)

    // ── 7. INVOICES (customer-facing) ─────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_invoices (
        id             SERIAL PRIMARY KEY,
        order_id       INTEGER UNIQUE NOT NULL,
        invoice_number TEXT UNIQUE NOT NULL,
        pdf_url        TEXT,
        subtotal       NUMERIC(10,2),
        delivery_fee   NUMERIC(10,2),
        discount       NUMERIC(10,2) DEFAULT 0,
        total          NUMERIC(10,2),
        generated_at   TIMESTAMP DEFAULT NOW()
      )`)

    // ── 8. PARTNER ONLINE STATUS ──────────────────────────────────────────
    // Column on the existing table, not a new one.
    await pool.query(`ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT false`)
    await pool.query(`ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS last_online_at TIMESTAMP`)
    await pool.query(`ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS cash_balance NUMERIC(10,2) DEFAULT 0`)

    // ── 9. DEFAULT RATE SETTINGS (admin-tunable, no redeploy) ─────────────
    await pool.query(`
      INSERT INTO app_settings(key, value) VALUES
        ('partner_base_pay','25'),
        ('partner_per_km','6'),
        ('partner_min_pay','25'),
        ('partner_max_pay','200'),
        ('partner_free_km','1'),
        ('partner_rain_surge','15'),
        ('partner_peak_surge','20'),
        ('partner_rain_active','0'),
        ('partner_referral_reward','200'),
        ('partner_payout_cycle_days','7')
      ON CONFLICT (key) DO NOTHING`)

    // ── 10. SEED A BASE RATE CARD if none exists ─────────────────────────
    const rc = await pool.query(`SELECT 1 FROM partner_rate_cards WHERE kind='base' LIMIT 1`)
    if (rc.rows.length === 0) {
      await pool.query(
        `INSERT INTO partner_rate_cards(name, kind, config, is_active)
         VALUES('Standard Base Rate','base',
                '{"base_pay":25,"per_km":6,"free_km":1,"min_pay":25,"max_pay":200}', true)`)
    }

    console.log("✓ partner platform schema ensured")
  } catch (e) {
    console.log("ensurePartnerPlatformSchema error:", e.message)
  }
}

module.exports = ensurePartnerPlatformSchema
