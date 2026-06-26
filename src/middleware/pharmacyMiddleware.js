const pool = require("../config/db")

const PHARMACY_ROLES = ["pharmacy", "pharmacist", "pharmacy_vendor"]

// Allow only pharmacy-role users; attaches req.pharmacy (their pharmacy row).
async function pharmacyOnly(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" })
    const role = String(req.user.role || "").toLowerCase()
    if (!PHARMACY_ROLES.includes(role)) {
      return res.status(403).json({ message: "Pharmacy access only" })
    }
    const ph = await pool.query(
      `SELECT * FROM pharmacies WHERE owner_user_id=$1 LIMIT 1`, [req.user.id])
    if (ph.rows.length === 0) {
      return res.status(403).json({ message: "No pharmacy linked to this account" })
    }
    req.pharmacy = ph.rows[0]
    next()
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}

module.exports = { pharmacyOnly, PHARMACY_ROLES }
