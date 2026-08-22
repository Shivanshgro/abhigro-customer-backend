const pool = require("../../config/db")

// POST /api/address
const addAddress = async (req, res) => {
  try {
    const b = req.body || {}
    const user_id = req.user.id

    const name      = b.name ?? b.full_name
    const phone     = b.phone
    const address   = b.address ?? b.address_line
    const city      = b.city
    const state     = b.state ?? null
    const pincode   = b.pincode
    const label     = b.label ?? null
    const latitude  = b.latitude  ?? b.lat ?? null
    const longitude = b.longitude ?? b.lng ?? null

    if (!name || !phone || !address || !city || !pincode) {
      return res.status(400).json({ message: "Name, phone, address, city and pincode are required" })
    }

    const lat = latitude  == null || latitude  === "" ? null : Number(latitude)
    const lng = longitude == null || longitude === "" ? null : Number(longitude)
    if ((lat != null && isNaN(lat)) || (lng != null && isNaN(lng))) {
      return res.status(400).json({ message: "Invalid coordinates" })
    }

    const result = await pool.query(
      `INSERT INTO addresses
         (user_id, full_name, phone, address_line, city, state, pincode, label, latitude, longitude)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, id AS "_id", user_id,
                 full_name AS name, full_name,
                 phone,
                 address_line AS address, address_line,
                 city, state, pincode, label, latitude, longitude`,
      [user_id, name, phone, address, city, state, pincode, label, lat, lng]
    )

    res.json({ success: true, address: result.rows[0] })
  } catch (error) {
    console.log("addAddress error:", error.message)
    res.status(500).json({ message: error.message })
  }
}

module.exports = addAddress