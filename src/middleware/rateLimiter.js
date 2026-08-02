const rateLimit = require("express-rate-limit")

// All thresholds env-configurable (fall back to sane defaults).
const N = (v, d) => (Number(process.env[v]) || d)

// Public / global API — loose
const apiLimiter = rateLimit({
  windowMs: N("RL_API_WINDOW_MS", 15 * 60 * 1000),
  max: N("RL_API_MAX", 1000),
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
})

// Authenticated user actions — moderate (keyed by user id when available)
const userLimiter = rateLimit({
  windowMs: N("RL_USER_WINDOW_MS", 15 * 60 * 1000),
  max: N("RL_USER_MAX", 300),
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : req.ip),
  message: { success: false, message: "Too many requests. Please slow down." },
})

// Auth routes (OTP/login) — strict, per-IP; short window to allow legit retries w/o hard lockout
const authLimiter = rateLimit({
  windowMs: N("RL_AUTH_WINDOW_MS", 10 * 60 * 1000),
  max: N("RL_AUTH_MAX", 20),           // ~ per IP per window across all auth calls
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please wait a few minutes and try again." },
})

// OTP send specifically — very strict per IP (prevents SMS-bombing / cost abuse)
const otpLimiter = rateLimit({
  windowMs: N("RL_OTP_WINDOW_MS", 15 * 60 * 1000),
  max: N("RL_OTP_MAX", 6),
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many OTP requests. Please wait before requesting another code." },
})

module.exports = apiLimiter
module.exports.apiLimiter = apiLimiter
module.exports.userLimiter = userLimiter
module.exports.authLimiter = authLimiter
module.exports.otpLimiter = otpLimiter
