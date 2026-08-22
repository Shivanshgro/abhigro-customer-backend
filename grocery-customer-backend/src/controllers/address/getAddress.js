const pool = require("../../config/db")

const getAddress = async (req, res) => {
  try {
    const user_id = req.user.id
    const result = await pool.query(
      `SELECT 
        id,
        id AS "_id",
        full_name AS name,
        full_name,
        phone,
        address_line AS address,
        address_line,
        city,
        state,
        pincode,
        label,
        latitude,
        longitude,
        is_default
       FROM addresses
       WHERE user_id = $1
       ORDER BY is_default DESC NULLS LAST, id DESC`,
      [user_id]
    )
    res.json(result.rows)
  } catch (error) {
    console.log("getAddress error:", error.message)
    res.status(500).json({ message: error.message })
  }
}

module.exports = getAddress