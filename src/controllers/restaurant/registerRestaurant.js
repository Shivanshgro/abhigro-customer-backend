const pool = require("../../config/db")

// POST /api/restaurant/register  (auth — links to current user as owner)
// FSSAI number + certificate are MANDATORY. Status starts 'pending'.
const registerRestaurant = async (req, res) => {
  try {
    const ownerId = req.user.id
    const {
      restaurant_name, owner_name, phone, email, address, latitude, longitude, pincode,
      fssai_number, fssai_certificate, pan_number, gst_number,
      bank_account_details, upi_id, restaurant_images, menu_images,
      opening_time, closing_time, food_type, cuisine_type,
    } = req.body

    if (!restaurant_name) return res.status(400).json({ message: "Restaurant name is required" })
    if (!fssai_number) return res.status(400).json({ message: "FSSAI number is mandatory" })
    if (!fssai_certificate) return res.status(400).json({ message: "FSSAI certificate upload is mandatory" })

    // prevent duplicate restaurant per owner
    const exists = await pool.query(`SELECT id, approval_status FROM food_restaurants WHERE owner_id=$1`, [ownerId])
    if (exists.rows.length > 0) {
      return res.status(409).json({ message: "You already have a restaurant registered", restaurant_id: exists.rows[0].id, approval_status: exists.rows[0].approval_status })
    }

    const r = await pool.query(
      `INSERT INTO food_restaurants
        (owner_id, restaurant_name, owner_name, phone, email, address, latitude, longitude, pincode,
         fssai_number, fssai_certificate, pan_number, gst_number, bank_account_details, upi_id,
         restaurant_images, menu_images, opening_time, closing_time, food_type, cuisine_type,
         is_approved, approval_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,false,'pending')
       RETURNING id, restaurant_name, approval_status`,
      [ownerId, restaurant_name, owner_name||null, phone||null, email||null, address||null,
       latitude||null, longitude||null, pincode||null, fssai_number, fssai_certificate,
       pan_number||null, gst_number||null, bank_account_details||null, upi_id||null,
       restaurant_images||null, menu_images||null, opening_time||null, closing_time||null,
       food_type||null, cuisine_type||null])

    res.json({ success: true, message: "Restaurant registered. Awaiting admin approval.", restaurant: r.rows[0] })
  } catch (e) {
    console.log("registerRestaurant error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = registerRestaurant
