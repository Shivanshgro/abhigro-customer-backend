const pool = require("../config/db")

// notify({ to:'admin'|'vendor'|'pharmacy'|'restaurant'|'delivery'|'customer',
//          userId: users.id or null (null = everyone of that type, e.g. all admins / all delivery),
//          type, title, message, data })
// Stores in DB (survives refresh) + emits a live socket event (clients filter by own identity).
async function notify({ to, userId = null, type, title, message = "", data = {} }) {
  try {
    const r = await pool.query(
      `INSERT INTO panel_notifications (recipient_type, recipient_id, type, title, message, data)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [to, userId, type, title, message, JSON.stringify(data)])
    try {
      const { getIO } = require("../socket/emit")
      const io = getIO()
      if (io) io.emit("panelNotify", r.rows[0])
    } catch (e) { /* socket optional */ }
    return r.rows[0]
  } catch (e) {
    console.log("notify error:", e.message)
    return null
  }
}
module.exports = notify
