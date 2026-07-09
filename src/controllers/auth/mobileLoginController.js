const pool = require("../../config/db")
const jwt = require("jsonwebtoken")
const axios = require("axios")
const { checkEligibility } = require("../../services/roleEligibility")

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) { console.error("FATAL: JWT_SECRET env variable is not set"); }
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY

// POST /api/auth/mobile-login  { mobile, token, role }
// Verifies OTP, enforces the SELECTED role (registered + approved), then issues JWT.
const mobileLogin = async (req, res) => {
  try {
    const { mobile, token, role } = req.body
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

    // Enforce registration + selected role + approval
    let elig = await checkEligibility(mobile, role || "customer")
    // Customers: auto-create account on first login (mobile -> OTP -> in). One account per number.
    if (!elig.ok && (role || "customer") === "customer" && elig.code === "not_registered") {
      const pool = require("../../config/db")
      const ins = await pool.query(
        `INSERT INTO users(name, email, phone, role) VALUES($1,NULL,$2,'customer')
         ON CONFLICT DO NOTHING RETURNING *`, [`User${String(mobile).slice(-4)}`, mobile])
      const u2 = ins.rows[0] || (await pool.query(`SELECT * FROM users WHERE phone=$1 LIMIT 1`, [mobile])).rows[0]
      if (u2) elig = { ok: true, user: u2 }
    }
    if (!elig.ok) {
      return res.status(elig.code === "pending" ? 403 : 404).json({
        message: elig.message, notRegistered: elig.code === "not_registered" || elig.code === "wrong_role",
        pending: elig.code === "pending",
      })
    }

    const u = elig.user
    const accessToken = jwt.sign(
      { id: u.id, phone: u.phone, role: u.role || "customer", name: u.name },
      JWT_SECRET, { expiresIn: "7d" })
    const refreshToken = jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: "30d" })

    res.json({
      accessToken, refreshToken,
      user: { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role || "customer" },
    })
  } catch (error) {
    console.log("Mobile login error:", error.message)
    res.status(500).json({ message: "Login failed. Please try again." })
  }
}

module.exports = mobileLogin