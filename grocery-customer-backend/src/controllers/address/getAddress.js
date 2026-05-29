const pool = require("../../config/db")

const getAddress = async (req, res) => {
  try {
    const user_id = req.user.id

    const result = await pool.query(
      `SELECT 
        id,
        id AS "_id",
        full_name AS name,
        phone,
        address_line AS address,
        city,
        state,
        pincode
       FROM addresses
       WHERE user_id = $1
       ORDER BY id DESC`,
      [user_id]
    )

    res.json(result.rows)
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = getAddress