const pool = require("../../config/db")

const getProfile = async (req, res) => {
  try {
    const id = req.user.id  // from JWT token, not params

    const result = await pool.query(
      `SELECT id, name, email, phone, created_at FROM users WHERE id=$1`,
      [id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User Not Found" })
    }

    res.json(result.rows[0])
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

const updateProfile = async (req, res) => {
  try {
    const id = req.user.id  // from JWT token, not body
    const { name, email, phone } = req.body

    const result = await pool.query(
      `UPDATE users SET name=$1, email=$2, phone=$3 WHERE id=$4
       RETURNING id, name, email, phone`,
      [name, email, phone, id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User Not Found" })
    }

    res.json({ success: true, ...result.rows[0] })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = { getProfile, updateProfile }
