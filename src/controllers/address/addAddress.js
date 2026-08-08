const pool = require("../../config/db")

const addAddress = async (req, res) => {
  try {
    // Frontend sends: name, phone, address, city, pincode
    // Optional: latitude, longitude (captured from GPS or geocoding) — used for
    // radius-based fulfillment routing. Nullable: routing falls back to pincode.
    const { name, phone, address, city, pincode, latitude, longitude } = req.body
    const user_id = req.user.id

    if (!name || !phone || !address || !city || !pincode) {
      return res.status(400).json({ message: "All fields are required" })
    }

    const lat = (latitude === undefined || latitude === null || latitude === "") ? null : Number(latitude)
    const lng = (longitude === undefined || longitude === null || longitude === "") ? null : Number(longitude)
    const safeLat = Number.isFinite(lat) ? lat : null
    const safeLng = Number.isFinite(lng) ? lng : null

    const result = await pool.query(
      `INSERT INTO addresses(user_id, full_name, phone, address_line, city, pincode, latitude, longitude)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, user_id, full_name AS name, phone, address_line AS address, city, pincode, latitude, longitude`,
      [user_id, name, phone, address, city, pincode, safeLat, safeLng]
    )

    res.json({ success: true, address: result.rows[0] })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = addAddress