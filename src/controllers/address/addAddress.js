const pool = require("../../config/db")

const addAddress = async (req, res) => {
  try {
    // Frontend sends: name, phone, address, city, pincode
    const { name, phone, address, city, pincode } = req.body
    const user_id = req.user.id

    if (!name || !phone || !address || !city || !pincode) {
      return res.status(400).json({ message: "All fields are required" })
    }

    const result = await pool.query(
      `INSERT INTO addresses(user_id, full_name, phone, address_line, city, pincode)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id, user_id, full_name AS name, phone, address_line AS address, city, pincode`,
      [user_id, name, phone, address, city, pincode]
    )

    res.json({ success: true, address: result.rows[0] })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = addAddress
