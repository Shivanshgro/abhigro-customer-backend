const pool = require("../../config/db")

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params
    const { name, description, price, mrp, unit, stock, image, category_id, is_active } = req.body

    const result = await pool.query(
      `UPDATE products SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        price       = COALESCE($3, price),
        mrp         = COALESCE($4, mrp),
        unit        = COALESCE($5, unit),
        stock       = COALESCE($6, stock),
        image       = COALESCE($7, image),
        category_id = COALESCE($8, category_id),
        is_active   = COALESCE($9, is_active),
        updated_at  = NOW()
       WHERE id = $10 RETURNING *`,
      [name, description, price, mrp, unit, stock, image, category_id, is_active, id]
    )
    if (result.rows.length === 0) return res.status(404).json({ message: "Product not found" })
    res.json({ success: true, product: result.rows[0] })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}
module.exports = updateProduct
