const pool = require("./db")
async function ensureCareSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        order_type VARCHAR(20) DEFAULT 'grocery',
        order_id INTEGER,
        issue_type VARCHAR(40) NOT NULL,
        message TEXT DEFAULT '',
        status VARCHAR(20) DEFAULT 'open',
        admin_note TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_ratings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        order_type VARCHAR(20) DEFAULT 'grocery',
        order_id INTEGER NOT NULL,
        stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
        target VARCHAR(20) DEFAULT 'order',
        feedback TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (user_id, order_type, order_id, target)
      )`)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        amount NUMERIC NOT NULL,
        type VARCHAR(10) NOT NULL,          -- credit | debit
        reason VARCHAR(120) DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id, created_at DESC)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id, created_at DESC)`)
    console.log("✓ care schema ready (tickets/ratings/wallet)")
  } catch (e) { console.log("ensureCareSchema error:", e.message) }
}
module.exports = ensureCareSchema
