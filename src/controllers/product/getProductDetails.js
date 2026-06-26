const pool = require("../../config/db")

const getProductDetails = async (req, res) => {
  try {
    const { id } = req.params

    const product = await pool.query(
      `SELECT products.*, categories.name AS category
       FROM products
       LEFT JOIN categories ON products.category_id = categories.id
       WHERE products.id=$1`,
      [id]
    )

    if (product.rows.length === 0) {
      return res.status(404).json({ message: "Product Not Found" })
    }

    res.json(product.rows[0])
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = getProductDetails
