const pool = require("../../config/db")

// PUT /api/address/:id â update in place, scoped to the authenticated user.
const updateAddress = async (req, res) => {
  try {
    const user_id = req.user.id
    const b = req.body || {}
    const id = req.params.id ?? b.id
    if (!id) return res.status(400).json({ message: "Address id is required" })

    const existing = await pool.query(
      `SELECT * FROM addresses WHERE id=$1 AND user_id=$2`, [id, user_id])
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "Address not found" })
    }
    const cur = existing.rows[0]

    const pick = (a, bb, fallback) => {
      const v = a !== undefined ? a : bb
      return v === undefined ? fallback : v
    }
    const full_name    = pick(b.full_name, b.name, cur.full_name)
    const phone        = pick(b.phone, undefined, cur.phone)
    const address_line = pick(b.address_line, b.address, cur.address_line)
    const city         = pick(b.city, undefined, cur.city)
    const state        = pick(b.state, undefined, cur.state)
    const pincode      = pick(b.pincode, undefined, cur.pincode)
    const label        = pick(b.label, undefined, cur.label)

    let latitude  = pick(b.latitude,  b.lat, cur.latitude)
    let longitude = pick(b.longitude, b.lng, cur.longitude)
    latitude  = latitude  === "" || latitude  === null ? null : Number(latitude)
    longitude = longitude === "" || longitude === null ? null : Number(longitude)
    if ((latitude != null && isNaN(latitude)) || (longitude != null && isNaN(longitude))) {
      return res.status(400).json({ message: "Invalid coordinates" })
    }

    const result = await pool.query(
      `UPDATE addresses SET
         full_name=$1, phone=$2, address_line=$3, city=$4,
         state=$5, pincode=$6, label=$7, latitude=$8, longitude=$9
       WHERE id=$10 AND user_id=$11
       RETURNING id, id AS "_id", user_id,
                 full_name AS name, full_name,
                 phone,
                 address_line AS address, address_line,
                 city, state, pincode, label, latitude, longitude`,
      [full_name, phone, address_line, city, state, pincode, label,
       latitude, longitude, id, user_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Address not found" })
    }

    res.json({ success: true, address: result.rows[0] })
  } catch (error) {
    console.log("updateAddress error:", error.message)
    res.status(500).json({ message: error.message })
  }
}

module.exports = updateAddress