const pool = require("../../config/db")
const jwt = require("jsonwebtoken")
const axios = require("axios")
const { checkEligibility } = require("../../services/roleEligibility")
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) { console.error("FATAL: JWT_SECRET env variable is not set"); }
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY

const REVIEW_PHONE = "9999900000"
const REVIEW_OTP = "480216"

const mobileLogin = async (req, res) => {
  try {
    const { mobile, token, role } = req.body

    const reviewDigits = String(mobile || "").replace(/\D/g, "").slice(-10)
    if (reviewDigits === REVIEW_PHONE) {
      let tu = await pool.query(`SELECT * FROM users WHERE phone = $1`, [REVIEW_PHONE])
      if (tu.rows.length === 0) {
        tu = await pool.query(`INSERT INTO users(name, phone, role) VALUES('Play Reviewer',$1,'customer') RETURNING *`, [REVIEW_PHONE])
      }
      const tuser = tu.rows[0]
      const at = jwt.sign({ id: tuser.id, phone: tuser.phone, role: "customer", name: tuser.name }, JWT_SECRET, { expiresIn: "7d" })
      const rt = jwt.sign({ id: tuser.id }, JWT_SECRET, { expiresIn: "30d" })
      return res.json({ accessToken: at, refreshToken: rt, user: { id: tuser.id, name: tuser.name, email: tuser.email, phone: tuser.phone, role: "customer" } })
    }

    if (!mobile || !token) {
      return res.status(400).json({ message: "Mobile and token are required" })
    }
    const verifyRes = await axios.post(
      "https://control.msg91.com/api/v5/widget/verifyAccessToken",
      { authkey: MSG91_AUTH_KEY, "access-token": token },
      { headers: { "Content-Type": "application/json" } }
    )
    if (!verifyRes.data || verifyRes.data.type !== "success") {
      return res.status(401).json({ message: "Invalid OTP. Please try again." })
    }
    let elig = await checkEligibility(mobile, role || "customer")
    if (!elig.ok && (role || "customer") === "customer" && elig.code === "not_registered") {
      const ins = await pool.query(`INSERT INTO users(name, email, phone, role) VALUES($1,NULL,$2,'customer') ON CONFLICT DO NOTHING RETURNING *`, [`User${String(mobile).slice(-4)}`, mobile])
      const u2 = ins.rows[0] || (await pool.query(`SELECT * FROM users WHERE phone=$1 LIMIT 1`, [mobile])).rows[0]
      if (u2) elig = { ok: true, user: u2 }
    }
    if (!elig.ok) {
      return res.status(elig.code === "pending" ? 403 : 404).json({ message: elig.message, notRegistered: elig.code === "not_registered" || elig.code === "wrong_role", pending: elig.code === "pending" })
    }
    const u = elig.user
    const effectiveRole = (role || u.role || "customer")
    const accessToken = jwt.sign({ id: u.id, phone: u.phone, role: effectiveRole, name: u.name }, JWT_SECRET, { expiresIn: "7d" })
    const refreshToken = jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: "30d" })
    res.json({ accessToken, refreshToken, user: { id: u.id, name: u.name, email: u.email, phone: u.phone, role: effectiveRole } })
  } catch (error) {
    console.log("Mobile login error:", error.message)
    res.status(500).json({ message: "Login failed. Please try again." })
  }
}
module.exports = mobileLogin