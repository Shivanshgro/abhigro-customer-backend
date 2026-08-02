// Tiny strict validator — no dependency. Usage:
//   const { validate, F } = require("../middleware/validate")
//   router.post("/x", validate({ mobile: F.mobile, name: F.optional(F.str(1,80)) }), handler)
const rej = (res, msg) => res.status(400).json({ success: false, message: msg })

const F = {
  mobile: (v) => (/^\d{10}$/.test(String(v || "").replace(/\D/g, "").slice(-10)) ? null : "Valid 10-digit mobile required"),
  otp:    (v) => (/^\d{4,6}$/.test(String(v || "")) ? null : "Valid OTP required"),
  pincode:(v) => (/^\d{6}$/.test(String(v || "")) ? null : "Valid 6-digit pincode required"),
  email:  (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "")) ? null : "Valid email required"),
  int:    (min, max) => (v) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? null : `Must be an integer ${min}-${max}` },
  num:    (min, max) => (v) => { const n = Number(v); return !isNaN(n) && n >= min && n <= max ? null : `Must be a number ${min}-${max}` },
  str:    (min, max) => (v) => { const s = String(v ?? ""); return s.length >= min && s.length <= max ? null : `Length must be ${min}-${max}` },
  oneOf:  (...opts) => (v) => (opts.includes(v) ? null : `Must be one of: ${opts.join(", ")}`),
  optional: (fn) => (v) => (v === undefined || v === null || v === "" ? null : fn(v)),
}

function validate(schema) {
  return (req, res, next) => {
    const body = req.body || {}
    for (const key in schema) {
      const err = schema[key](body[key])
      if (err) return rej(res, `${key}: ${err}`)
    }
    next()
  }
}
module.exports = { validate, F }
