const pool = require("../config/db")

const ROLE_LABEL = {
  customer: "Customer", vendor: "Vendor", pharmacy: "Pharmacy",
  delivery: "Delivery Partner", admin: "Admin",
}

function normPhone(p) { return String(p || "").replace(/\D/g, "").slice(-10) }

// normalize stored role variants to a canonical role
function canonical(r) {
  const x = String(r || "customer").toLowerCase()
  if (x === "pharmacist" || x === "pharmacy_vendor") return "pharmacy"
  if (x === "delivery_boy") return "delivery"
  return x
}

// Checks: registered? role matches? approved/active?
// Returns { ok, user?, message?, code? }
async function checkEligibility(mobile, role) {
  const phone = normPhone(mobile)
  const want = String(role || "customer").toLowerCase()
  const label = ROLE_LABEL[want] || "Customer"
  if (phone.length !== 10) return { ok: false, message: "Enter a valid 10-digit mobile number" }

  const u = await pool.query(`SELECT * FROM users WHERE phone=$1`, [phone])
  if (u.rows.length === 0) {
    return { ok: false, code: "not_registered",
      message: `This mobile number is not registered as ${label}. Please register as ${label} first.` }
  }
  const user = u.rows[0]

  // role match
  if (canonical(user.role) !== want) {
    return { ok: false, code: "wrong_role",
      message: `This mobile number is not registered as ${label}. Please register as ${label} first.` }
  }

  // approval checks for partner roles
  if (want === "vendor") {
    const s = await pool.query(`SELECT is_active FROM shops WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1`, [user.id])
    if (s.rows.length === 0) return { ok: false, code: "not_registered", message: `This mobile number is not registered as Vendor. Please register as Vendor first.` }
    if (!s.rows[0].is_active) return { ok: false, code: "pending", message: "Your vendor account is pending admin approval." }
  } else if (want === "pharmacy") {
    const s = await pool.query(`SELECT is_active FROM pharmacies WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1`, [user.id])
    if (s.rows.length === 0) return { ok: false, code: "not_registered", message: `This mobile number is not registered as Pharmacy. Please register as Pharmacy first.` }
    if (!s.rows[0].is_active) return { ok: false, code: "pending", message: "Your pharmacy account is pending admin approval." }
  } else if (want === "delivery") {
    const s = await pool.query(`SELECT is_approved FROM delivery_partners WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [user.id])
    if (s.rows.length === 0) return { ok: false, code: "not_registered", message: `This mobile number is not registered as Delivery Partner. Please register as Delivery Partner first.` }
    if (!s.rows[0].is_approved) return { ok: false, code: "pending", message: "Your delivery account is pending admin approval." }
  }

  return { ok: true, user }
}

module.exports = { checkEligibility, ROLE_LABEL, canonical }