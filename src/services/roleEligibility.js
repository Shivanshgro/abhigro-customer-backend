const pool = require("../config/db")

const ROLE_LABEL = {
  customer: "Customer", vendor: "Vendor", pharmacy: "Pharmacy",
  delivery: "Delivery Partner", restaurant: "Restaurant", admin: "Admin",
}

function normPhone(p) { return String(p || "").replace(/\D/g, "").slice(-10) }

function canonical(r) {
  const x = String(r || "customer").toLowerCase()
  if (x === "pharmacist" || x === "pharmacy_vendor") return "pharmacy"
  if (x === "delivery_boy") return "delivery"
  return x
}

// Eligibility is RECORD-BASED for partner roles: a user is a valid vendor if they
// OWN a shop (approved), regardless of the volatile users.role column. This fixes
// the "sometimes logs in, sometimes says not registered" problem, which happened
// when a partner's role got changed to 'customer' (Option-1 shopping) while they
// still owned an approved shop.
// Returns { ok, user?, message?, code? }
async function checkEligibility(mobile, role) {
  const phone = normPhone(mobile)
  const want = String(role || "customer").toLowerCase()
  const label = ROLE_LABEL[want] || "Customer"
  if (phone.length !== 10) return { ok: false, code: "bad_phone", message: "Enter a valid 10-digit mobile number" }

  const u = await pool.query(`SELECT * FROM users WHERE phone=$1`, [phone])
  if (u.rows.length === 0) {
    return { ok: false, code: "not_registered",
      message: `This mobile number is not registered. Please register first.` }
  }
  const user = u.rows[0]

  // Customer login is OPEN to any registered account (everyone can shop).
  if (want === "customer") return { ok: true, user }

  // ---- Partner roles: decide by OWNERSHIP of the partner record, not users.role ----
  if (want === "vendor") {
    const s = await pool.query(
      `SELECT is_active FROM shops WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1`, [user.id])
    if (s.rows.length === 0)
      return { ok: false, code: "not_registered",
        message: `This mobile number is not registered as a Vendor. Please register as a Vendor first.` }
    if (!s.rows[0].is_active)
      return { ok: false, code: "pending",
        message: `Your vendor account is awaiting admin approval. You'll be able to log in once approved.` }
    return { ok: true, user }
  }

  if (want === "pharmacy") {
    const s = await pool.query(
      `SELECT is_active FROM pharmacies WHERE owner_user_id=$1 ORDER BY id DESC LIMIT 1`, [user.id])
    if (s.rows.length === 0)
      return { ok: false, code: "not_registered",
        message: `This mobile number is not registered as a Pharmacy. Please register as a Pharmacy first.` }
    if (!s.rows[0].is_active)
      return { ok: false, code: "pending",
        message: `Your pharmacy account is awaiting admin approval. You'll be able to log in once approved.` }
    return { ok: true, user }
  }

  if (want === "delivery") {
    const s = await pool.query(
      `SELECT is_approved FROM delivery_partners WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [user.id])
    if (s.rows.length === 0)
      return { ok: false, code: "not_registered",
        message: `This mobile number is not registered as a Delivery Partner. Please register as a Delivery Partner first.` }
    if (!s.rows[0].is_approved)
      return { ok: false, code: "pending",
        message: `Your delivery account is awaiting admin approval. You'll be able to log in once approved.` }
    return { ok: true, user }
  }

  if (want === "restaurant") {
    const s = await pool.query(
      `SELECT is_approved FROM food_restaurants WHERE owner_id=$1 ORDER BY id DESC LIMIT 1`, [user.id])
    if (s.rows.length === 0)
      return { ok: false, code: "not_registered",
        message: `This mobile number is not registered as a Restaurant. Please register as a Restaurant first.` }
    // Note: restaurant can log in to its panel even while pending, to set up menu.
    return { ok: true, user }
  }

  // admin or unknown role: fall back to role match
  if (canonical(user.role) !== want) {
    return { ok: false, code: "wrong_role",
      message: `This mobile number is not registered as ${label}.` }
  }
  return { ok: true, user }
}

module.exports = { checkEligibility, ROLE_LABEL, canonical }
