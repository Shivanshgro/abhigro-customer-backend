const pool = require("../../config/db")

const searchProducts = async (req, res) => {
  try {
    // Frontend sends ?q=..., also support ?name=... for compat
    const query = req.query.q || req.query.name || ""

    if (!query.trim()) {
      return res.json({ success: true, products: [] })
    }

    const products = await pool.query(
      `SELECT products.*, categories.name AS category_name
       FROM products
       LEFT JOIN categories ON products.category_id = categories.id
       WHERE LOWER(products.name) LIKE LOWER($1)
          OR LOWER(products.description) LIKE LOWER($1)
       ORDER BY products.name`,
      [`%${query}%`]
    )

    res.json({ success: true, products: products.rows })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = searchProducts
