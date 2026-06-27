const pool = require("../../config/db")

function normPhone(p) { return String(p || "").replace(/\D/g, "").slice(-10) }

async function findOrCreateUser(name, phone, role) {
  const u = await pool.query(`SELECT id FROM users WHERE phone=$1`, [phone])
  if (u.rows.length > 0) {
    await pool.query(`UPDATE users SET role=$1 WHERE id=$2`, [role, u.rows[0].id])
    return u.rows[0].id
  }
  const c = await pool.query(`INSERT INTO users(name, phone, role) VALUES($1,$2,$3) RETURNING id`, [name, phone, role])
  return c.rows[0].id
}

const registerRestaurant = async (req, res) => {
  try {
    const b = req.body || {}
    const phone = normPhone(b.phone)
    if (!b.restaurant_name) return res.status(400).json({ message: "Restaurant name is required" })
    if (phone.length !== 10) return res.status(400).json({ message: "Valid 10-digit phone is required" })
    if (!b.fssai_number) return res.status(400).json({ message: "FSSAI number is mandatory" })
    if (!b.fssai_certificate) return res.status(400).json({ message: "FSSAI certificate upload is mandatory" })

    const ownerId = await findOrCreateUser(b.owner_name || b.restaurant_name, phone, "restaurant")

    const dup = await pool.query(`SELECT id, approval_status FROM food_restaurants WHERE owner_id=$1`, [ownerId])
    if (dup.rows.length > 0) {
      return res.status(409).json({ message: "A restaurant is already registered for this phone number.",
        restaurant_id: dup.rows[0].id, approval_status: dup.rows[0].approval_status })
    }

    const r = await pool.query(
      `INSERT INTO food_restaurants
        (owner_id, restaurant_name, owner_name, phone, email, address, latitude, longitude, pincode,
         fssai_number, fssai_certificate, pan_number, gst_number, bank_account_details, upi_id,
         restaurant_images, menu_images, opening_time, closing_time, food_type, cuisine_type,
         is_approved, approval_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,false,'pending')
       RETURNING id, restaurant_name, approval_status`,
      [ownerId, b.restaurant_name, b.owner_name||null, phone, b.email||null, b.address||null,
       b.latitude||null, b.longitude||null, b.pincode||null, b.fssai_number, b.fssai_certificate,
       b.pan_number||null, b.gst_number||null, b.bank_account_details||null, b.upi_id||null,
       b.restaurant_images||null, b.menu_images||null, b.opening_time||null, b.closing_time||null,
       b.food_type||null, b.cuisine_type||null])

    res.json({ success: true, message: "Restaurant registered. Awaiting admin approval. You can now log in using the Restaurant tab.", restaurant: r.rows[0] })
  } catch (e) {
    console.log("registerRestaurant error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = registerRestaurant