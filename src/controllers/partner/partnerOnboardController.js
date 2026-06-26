const pool = require("../../config/db")

function normPhone(p) { return String(p || "").replace(/\D/g, "").slice(-10) }

async function findOrCreateUser(name, phone, role) {
  const u = await pool.query(`SELECT id FROM users WHERE phone=$1`, [phone])
  if (u.rows.length > 0) {
    await pool.query(`UPDATE users SET role=$1 WHERE id=$2`, [role, u.rows[0].id])
    return u.rows[0].id
  }
  const c = await pool.query(
    `INSERT INTO users(name, phone, role) VALUES($1,$2,$3) RETURNING id`, [name, phone, role])
  return c.rows[0].id
}

// POST /api/register/vendor  (PUBLIC) — vendor / supplier self-onboarding
exports.registerVendor = async (req, res) => {
  try {
    const b = req.body || {}
    const phone = normPhone(b.phone)
    if (!b.shop_name || phone.length !== 10 || !b.pincode || !b.vendor_type) {
      return res.status(400).json({ message: "Shop name, 10-digit phone, pincode and shop type are required" })
    }
    const userId = await findOrCreateUser(b.shop_name, phone, "vendor")

    const dup = await pool.query(`SELECT id, is_active FROM shops WHERE owner_user_id=$1`, [userId])
    if (dup.rows.length > 0) {
      return res.status(409).json({ message: "A shop is already registered for this phone number.",
        status: dup.rows[0].is_active ? "approved" : "pending" })
    }

    const categories = Array.isArray(b.categories) ? b.categories.join(", ") : (b.categories || "")
    const ins = await pool.query(
      `INSERT INTO shops(owner_user_id, shop_name, owner_name, phone, email, address, pincode, city, state,
         vendor_type, categories, gst_number, fssai_number, open_time, close_time, service_pincodes,
         account_holder, account_number, ifsc, is_active, is_online)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,false,false)
       RETURNING id, shop_name, is_active`,
      [userId, b.shop_name, b.owner_name || null, phone, b.email || null, b.address || null, b.pincode,
       b.city || null, b.state || null, b.vendor_type, categories, b.gst_number || null, b.fssai_number || null,
       b.open_time || null, b.close_time || null, b.service_pincodes || null,
       b.account_holder || null, b.account_number || null, b.ifsc || null])

    res.json({ success: true, message: "Registration submitted. Your shop is pending admin verification.", shop: ins.rows[0] })
  } catch (e) {
    console.log("registerVendor error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// POST /api/register/delivery  (PUBLIC) — delivery partner self-onboarding
exports.registerDelivery = async (req, res) => {
  try {
    const b = req.body || {}
    const phone = normPhone(b.phone)
    if (!b.full_name || phone.length !== 10 || !b.pincode || !b.vehicle_type) {
      return res.status(400).json({ message: "Full name, 10-digit phone, pincode and vehicle type are required" })
    }
    const userId = await findOrCreateUser(b.full_name, phone, "delivery")

    const dup = await pool.query(`SELECT id, is_approved FROM delivery_partners WHERE user_id=$1`, [userId])
    if (dup.rows.length > 0) {
      return res.status(409).json({ message: "A delivery partner is already registered for this phone number.",
        status: dup.rows[0].is_approved ? "approved" : "pending" })
    }

    const ins = await pool.query(
      `INSERT INTO delivery_partners(user_id, full_name, phone, email, address, pincode, city,
         vehicle_type, vehicle_number, emergency_contact, account_holder, account_number, ifsc, work_pincode, is_approved)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false)
       RETURNING id, full_name, is_approved`,
      [userId, b.full_name, phone, b.email || null, b.address || null, b.pincode, b.city || null,
       b.vehicle_type, b.vehicle_number || null, b.emergency_contact || null,
       b.account_holder || null, b.account_number || null, b.ifsc || null, b.work_pincode || null])

    res.json({ success: true, message: "Registration submitted. You are pending admin verification.", partner: ins.rows[0] })
  } catch (e) {
    console.log("registerDelivery error:", e.message)
    res.status(500).json({ message: e.message })
  }
}