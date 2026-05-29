const pool = require("../../config/db")

const getProducts = async (req, res) => {
  try {
    const { category, limit = 100, page = 1 } = req.query
    const offset = (page - 1) * limit

    let queryText = `
      SELECT products.*, categories.name AS category_name
      FROM products
      LEFT JOIN categories ON products.category_id = categories.id
    `
    const params = []

    if (category) {
      params.push(category)
      queryText += ` WHERE LOWER(categories.name) = LOWER($${params.length})`
    }

    queryText += ` ORDER BY products.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit, offset)

    const products = await pool.query(queryText, params)

    res.json({ success: true, products: products.rows })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = getProducts
