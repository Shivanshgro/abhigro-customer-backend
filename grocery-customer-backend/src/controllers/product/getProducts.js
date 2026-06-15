const pool = require("../../config/db")

const getProducts = async (req, res) => {
  try {
    const { category, region, limit = 100, page = 1 } = req.query
    const offset = (page - 1) * limit

    let queryText = `
      SELECT products.*, categories.name AS category_name
      FROM products
      LEFT JOIN categories ON products.category_id = categories.id
      WHERE products.is_active = true
    `
    const params = []

    // Region filter: show 'all' products + products for the user's region
    if (region) {
      params.push(region)
      queryText += ` AND (products.region = 'all' OR products.region = $${params.length})`
    }

    if (category) {
      params.push(category)
      queryText += ` AND LOWER(categories.name) = LOWER($${params.length})`
    }

    params.push(limit, offset)
    queryText += ` ORDER BY products.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`

    const products = await pool.query(queryText, params)
    res.json({ success: true, products: products.rows })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = getProducts
