const pool = require("./db")

// Panel notifications: admin + vendor + pharmacy + restaurant + delivery + customer.
// Separate from the existing customer 'notifications' table to avoid breaking it.
async function ensureNotifySchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS panel_notifications (
        id SERIAL PRIMARY KEY,
        recipient_type VARCHAR(20) NOT NULL,
        recipient_id INTEGER,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(200) NOT NULL,
        message TEXT DEFAULT '',
        data JSONB DEFAULT '{}'::jsonb,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_panel_notif ON panel_notifications(recipient_type, recipient_id, is_read, created_at DESC)`)
    console.log("✓ panel_notifications ready")
  } catch (e) { console.log("ensureNotifySchema error:", e.message) }
}
module.exports = ensureNotifySchema
