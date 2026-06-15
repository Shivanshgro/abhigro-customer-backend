const pool = require("../../config/db")

const addProduct = async (req, res) => {
  try {
    const { name, description, price, mrp, unit, stock, image, category_id } = req.body
    if (!name || !price || !category_id) {
      return res.status(400).json({ message: "name, price and category_id are required" })
    }
    const result = await pool.query(
      `INSERT INTO products (name, description, price, mrp, unit, stock, image, category_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, true) RETURNING *`,
      [name, description || "", price, mrp || price, unit || "", stock || 0, image || "", category_id]
    )
    res.json({ success: true, product: result.rows[0] })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}
module.exports = addProduct
