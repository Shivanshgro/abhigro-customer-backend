const pool = require("../../config/db")

function normPhone(p) {
  const d = String(p || "").replace(/\D/g, "")
  return d.slice(-10)
}

// POST /api/medicine/pharmacy/register  (PUBLIC — pharmacy self-onboarding)
// Creates a pending pharmacy (is_active=false) + a linked pharmacy login account.
// Admin reviews and approves it in the admin panel.
exports.registerPharmacy = async (req, res) => {
  try {
    const b = req.body || {}
    const phone = normPhone(b.phone)

    // required fields
    if (!b.pharmacy_name || phone.length !== 10 || !b.drug_license_number || !b.pincode) {
      return res.status(400).json({
        message: "Pharmacy name, 10-digit phone, drug licence number and pincode are required",
      })
    }

    // find or create the pharmacy login user, ensure role = pharmacy
    let user = await pool.query(`SELECT * FROM users WHERE phone=$1`, [phone])
    let userId
    if (user.rows.length > 0) {
      userId = user.rows[0].id
      await pool.query(`UPDATE users SET role='pharmacy' WHERE id=$1`, [userId])
    } else {
      const created = await pool.query(
        `INSERT INTO users(name, phone, role) VALUES($1,$2,'pharmacy') RETURNING id`,
        [b.pharmacy_name, phone]
      )
      userId = created.rows[0].id
    }

    // prevent duplicate pharmacy for the same owner
    const existing = await pool.query(`SELECT id, is_active FROM pharmacies WHERE owner_user_id=$1`, [userId])
    if (existing.rows.length > 0) {
      return res.status(409).json({
        message: "A pharmacy is already registered for this phone number.",
        pharmacy_id: existing.rows[0].id,
        status: existing.rows[0].is_active ? "approved" : "pending",
      })
    }

    const ins = await pool.query(
      `INSERT INTO pharmacies(owner_user_id, pharmacy_name, owner_name, phone, email, address, pincode,
         latitude, longitude, drug_license_number, license_expiry_date, gst_number,
         pharmacist_name, pharmacist_registration_number, is_active, is_online)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,false)
       RETURNING id, pharmacy_name, is_active`,
      [userId, b.pharmacy_name, b.owner_name || null, phone, b.email || null, b.address || null, b.pincode,
       b.latitude || null, b.longitude || null, b.drug_license_number, b.license_expiry_date || null,
       b.gst_number || null, b.pharmacist_name || null, b.pharmacist_registration_number || null]
    )

    res.json({
      success: true,
      message: "Registration submitted. Your pharmacy is pending admin verification. You can log in once approved.",
      pharmacy: ins.rows[0],
    })
  } catch (e) {
    console.log("registerPharmacy error:", e.message)
    res.status(500).json({ message: e.message })
  }
}