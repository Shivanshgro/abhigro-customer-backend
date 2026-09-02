const pool = require("../../config/db")
const jwt = require("jsonwebtoken")
const axios = require("axios")
const { checkEligibility } = require("../../services/roleEligibility")

const JWT_SECRET = process.env.JWT_SECRET || "grocery_secret"
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY
const MSG91_OTP_TEMPLATE_ID = process.env.MSG91_OTP_TEMPLATE_ID || process.env.MSG91_TEMPLATE_ID

// Normalize an Indian mobile to MSG91 format: 91XXXXXXXXXX (digits only, last 10 + 91)
function normalizeMobile(mobile) {
  const digits = String(mobile || "").replace(/\D/g, "")
  const last10 = digits.slice(-10)
  return { last10, msg91: `91${last10}`, valid: last10.length === 10 }
}

// POST /api/auth/send-otp  { mobile }
// Backend calls MSG91 server OTP API. Frontend never sees the auth key.
exports.sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body || {}
    const m = normalizeMobile(mobile)
    if (!m.valid) return res.status(400).json({ message: "Enter a valid 10-digit mobile number" })

    // The review account never receives a real SMS, so do not spend one.
    const demoList = String(process.env.DEMO_LOGIN_PHONE || "")
      .split(",").map(x => x.trim()).filter(Boolean)
    if (demoList.includes(m.last10)) {
      return res.json({ success: true, message: "OTP sent" })
    }

    if (!MSG91_AUTH_KEY || !MSG91_OTP_TEMPLATE_ID) {
      // Name the missing variable in the log, not to the customer - a
      // config gap is not something they can act on.
      console.log("OTP not configured. AUTH_KEY set:", !!MSG91_AUTH_KEY,
                  "TEMPLATE_ID set:", !!MSG91_OTP_TEMPLATE_ID)
      return res.status(503).json({ message: "OTP service is unavailable right now. Please try again shortly." })
    }

    const r = await axios.post(
      "https://control.msg91.com/api/v5/otp",
      { Param1: "value1" },
      {
        params: { template_id: MSG91_OTP_TEMPLATE_ID, mobile: m.msg91, authkey: MSG91_AUTH_KEY, otp_length: 4 },
        headers: { "Content-Type": "application/json", authkey: MSG91_AUTH_KEY },
      }
    )

    if (r.data && r.data.type === "success") {
      return res.json({ success: true, message: "OTP sent", request_id: r.data.request_id })
    }
    return res.status(400).json({ message: r.data?.message || "Could not send OTP" })
  } catch (e) {
    console.log("sendOtp error:", e.response?.data || e.message)
    res.status(500).json({ message: e.response?.data?.message || "Could not send OTP. Try again." })
  }
}

// POST /api/auth/resend-otp  { mobile }
exports.resendOtp = async (req, res) => {
  try {
    const m = normalizeMobile((req.body || {}).mobile)
    if (!m.valid) return res.status(400).json({ message: "Enter a valid 10-digit mobile number" })
    const r = await axios.get("https://control.msg91.com/api/v5/otp/retry", {
      params: { mobile: m.msg91, authkey: MSG91_AUTH_KEY, retrytype: "text" },
      headers: { authkey: MSG91_AUTH_KEY },
    })
    if (r.data && r.data.type === "success") return res.json({ success: true, message: "OTP resent" })
    return res.status(400).json({ message: r.data?.message || "Could not resend OTP" })
  } catch (e) {
    console.log("resendOtp error:", e.response?.data || e.message)
    res.status(500).json({ message: "Could not resend OTP" })
  }
}

// POST /api/auth/verify-otp  { mobile, otp }
// Verifies with MSG91, then logs in / auto-registers and returns JWT.
exports.verifyOtp = async (req, res) => {
  try {
    const { mobile, otp, role } = req.body || {}
    const m = normalizeMobile(mobile)
    if (!m.valid) return res.status(400).json({ message: "Enter a valid 10-digit mobile number" })
    if (!otp || String(otp).trim().length < 4) return res.status(400).json({ message: "Enter the OTP" })

    // ── Store review account ────────────────────────────────────────────
    // Google and Apple reviewers cannot receive an Indian SMS. Scoped to a
    // single number and controlled by env, so it can be switched off after
    // review without a deploy.
    // DEMO_LOGIN_PHONE takes one number or several, comma separated:
    //   9999900000,9999900001
    // Google and Apple review different apps at the same time, and a single
    // shared account would have to keep changing role mid-review.
    const DEMO_PHONES = String(process.env.DEMO_LOGIN_PHONE || "")
      .split(",").map(x => x.trim()).filter(Boolean)
    const DEMO_TOKEN = process.env.DEMO_LOGIN_TOKEN || ""
    const isDemo = DEMO_PHONES.length > 0 && DEMO_TOKEN &&
      DEMO_PHONES.includes(m.last10) && String(otp).trim() === DEMO_TOKEN

    if (!isDemo) {
      const verify = await axios.get("https://control.msg91.com/api/v5/otp/verify", {
        params: { otp: String(otp).trim(), mobile: m.msg91 },
        headers: { authkey: MSG91_AUTH_KEY },
      })

      if (!verify.data || verify.data.type !== "success") {
        return res.status(401).json({ message: verify.data?.message || "Invalid OTP. Please try again." })
      }
    }

    // ── role handling ───────────────────────────────────────────────────
    // The OTP proves the phone. It does not prove the person runs a shop,
    // a pharmacy or a bike. Without this check a customer who picked
    // "Vendor" was silently signed in as a customer and dropped on the
    // home page, with no explanation.
    //
    // Customer stays open to any number and auto-creates, exactly as
    // before. Partner roles must already be registered and approved.
    const want = String(role || "customer").toLowerCase()

    if (want !== "customer") {
      const elig = await checkEligibility(m.last10, want)
      if (!elig.ok) {
        return res.status(elig.code === "pending" ? 403 : 404).json({
          message: elig.message,
          notRegistered: elig.code === "not_registered" || elig.code === "wrong_role",
          pending: elig.code === "pending",
        })
      }
      const p = elig.user
      const accessToken = jwt.sign(
        { id: p.id, phone: p.phone, role: p.role || want, name: p.name },
        JWT_SECRET, { expiresIn: "7d" })
      const refreshToken = jwt.sign({ id: p.id }, JWT_SECRET, { expiresIn: "30d" })
      return res.json({
        success: true, accessToken, refreshToken,
        user: { id: p.id, name: p.name, email: p.email, phone: p.phone, role: p.role || want },
      })
    }

    // Find or create the customer
    let user = await pool.query(`SELECT * FROM users WHERE phone = $1`, [m.last10])
    if (user.rows.length === 0) {
      const created = await pool.query(
        `INSERT INTO users(name, phone, role) VALUES($1,$2,'customer') RETURNING *`,
        [`User${m.last10.slice(-4)}`, m.last10]
      )
      user = { rows: [created.rows[0]] }
    }
    const u = user.rows[0]

    const accessToken = jwt.sign(
      { id: u.id, phone: u.phone, role: u.role || "customer" }, JWT_SECRET, { expiresIn: "7d" }
    )
    const refreshToken = jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: "30d" })

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role || "customer" },
    })
  } catch (e) {
    console.log("verifyOtp error:", e.response?.data || e.message)
    res.status(500).json({ message: e.response?.data?.message || "Verification failed. Try again." })
  }
}
