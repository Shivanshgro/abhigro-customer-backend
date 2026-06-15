const pool = require("../../config/db")

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params
    await pool.query(`UPDATE products SET is_active = false WHERE id = $1`, [id])
    res.json({ success: true, message: "Product deactivated" })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}
module.exports = deleteProduct
