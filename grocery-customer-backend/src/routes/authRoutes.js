const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const login = require("../controllers/auth/loginController")
const register = require("../controllers/auth/registerController")
const refreshToken = require("../controllers/auth/refreshTokenController")
const { getProfile, updateProfile } = require("../controllers/auth/profileController")
const mobileLogin = require("../controllers/auth/mobileLoginController")
const mobileRegister = require("../controllers/auth/mobileRegisterController")
const checkRole = require("../controllers/auth/checkRoleController")
const otp = require("../controllers/auth/otpController")

router.post("/login", login)
router.post("/register", register)
router.post("/refresh", refreshToken)
router.get("/profile", auth, getProfile)
router.put("/profile", auth, updateProfile)
router.post("/mobile-login", mobileLogin)
router.post("/mobile-register", mobileRegister)
router.post("/check-role", checkRole)

// In-app OTP (server-side MSG91 — no widget, no redirect)
router.post("/send-otp", otp.sendOtp)
router.post("/resend-otp", otp.resendOtp)
router.post("/verify-otp", otp.verifyOtp)

// Forgot password - simple email notification for now
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body
    const pool = require("../config/db")
    const user = await pool.query(`SELECT id FROM users WHERE email=$1`, [email])
    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Email not found" })
    }
    // TODO: Send reset email via SendGrid/Nodemailer
    res.json({ success: true, message: "Reset link sent to your email" })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router