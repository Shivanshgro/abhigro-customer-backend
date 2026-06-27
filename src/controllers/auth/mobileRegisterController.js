const pool = require("../../config/db")
const jwt = require("jsonwebtoken")
const axios = require("axios")

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) { console.error("FATAL: JWT_SECRET env variable is not set"); }
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY

// POST /api/auth/mobile-register  { mobile, token, name, email }
// Verifies the OTP token, then CREATES the customer account (or logs in if exists).
const mobileRegister = async (req, res) => {
  try {
    const { mobile, token, name, email } = req.body
    if (!mobile || !token) {
      return res.status(400).json({ message: "Mobile and token are required" })
    }

    // Verify OTP token with MSG91
    const verifyRes = await axios.post(
      "https://control.msg91.com/api/v5/widget/verifyAccessToken",
      { authkey: MSG91_AUTH_KEY, "access-token": token },
      { headers: { "Content-Type": "application/json" } }
    )
    if (!verifyRes.data || verifyRes.data.type !== "success") {
      return res.status(401).json({ message: "Invalid OTP. Please try again." })
    }

    // If already registered, just log them in (keep their existing role/details)
    let user = await pool.query(`SELECT * FROM users WHERE phone = $1`, [mobile])
    if (user.rows.length === 0) {
      const created = await pool.query(
        `INSERT INTO users(name, email, phone, role) VALUES($1,$2,$3,'customer') RETURNING *`,
        [name || `User${mobile.slice(-4)}`, email || null, mobile]
      )
      user = { rows: [created.rows[0]] }
    } else if (name || email) {
      // backfill name/email if missing
      await pool.query(
        `UPDATE users SET name = COALESCE(NULLIF($1,''), name), email = COALESCE(NULLIF($2,''), email) WHERE id = $3`,
        [name || "", email || "", user.rows[0].id]
      )
      user = await pool.query(`SELECT * FROM users WHERE id = $1`, [user.rows[0].id])
    }

    const u = user.rows[0]
    const accessToken = jwt.sign(
      { id: u.id, phone: u.phone, role: u.role || "customer" }, JWT_SECRET, { expiresIn: "7d" })
    const refreshToken = jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: "30d" })

    res.json({
      accessToken, refreshToken,
      user: { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role || "customer" },
    })
  } catch (error) {
    console.log("Mobile register error:", error.message)
    res.status(500).json({ message: "Registration failed. Please try again." })
  }
}

module.exports = mobileRegister