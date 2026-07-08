const pool = require("../../config/db")

const CITY_STATE = {
  "bangalore":"Karnataka","bengaluru":"Karnataka","mysore":"Karnataka","mysuru":"Karnataka",
  "mangalore":"Karnataka","hubli":"Karnataka","pune":"Maharashtra","mumbai":"Maharashtra",
  "chennai":"Tamil Nadu","hyderabad":"Telangana","delhi":"Delhi",
}

// GET /api/products/search?q=&city=&pincode=&suggest=1
// Matches: product name, description, brand, category, subcategory.
// Respects hybrid location scope (global/state/city/pincode).
// suggest=1 -> lightweight top-8 payload for type-ahead.
const searchProducts = async (req, res) => {
  try {
    const query = (req.query.q || req.query.name || "").trim()
    const { city, pincode, suggest } = req.query
    if (!query) return res.json({ success: true, products: [] })

    const cityNorm = city ? String(city).trim().toLowerCase() : null
    const state = cityNorm ? CITY_STATE[cityNorm] : null

    const params = [`%${query}%`]
    const scope = ["products.availability_scope = 'global'", "products.availability_scope IS NULL"]
    if (state)   { params.push(state);   scope.push(`(products.availability_scope='state' AND LOWER(products.scope_value)=LOWER($${params.length}))`) }
    if (city)    { params.push(city);    scope.push(`(products.availability_scope='city' AND LOWER(products.scope_value)=LOWER($${params.length}))`) }
    if (pincode) { params.push(pincode); scope.push(`(products.availability_scope='pincode' AND products.scope_value=$${params.length})`) }

    const limit = suggest ? 8 : 100
    const q = `
      SELECT products.*, categories.name AS category_name,
             subcategories.name AS subcategory_name, brands.name AS brand_name
      FROM products
      LEFT JOIN categories    ON products.category_id    = categories.id
      LEFT JOIN subcategories ON products.subcategory_id = subcategories.id
      LEFT JOIN brands        ON products.brand_id       = brands.id
      WHERE products.is_active = true
        AND (${scope.join(" OR ")})
        AND (LOWER(products.name) LIKE LOWER($1)
          OR LOWER(products.description) LIKE LOWER($1)
          OR LOWER(brands.name) LIKE LOWER($1)
          OR LOWER(categories.name) LIKE LOWER($1)
          OR LOWER(subcategories.name) LIKE LOWER($1))
      ORDER BY
        CASE WHEN LOWER(products.name) LIKE LOWER($1) THEN 0
             WHEN LOWER(brands.name) LIKE LOWER($1) THEN 1
             ELSE 2 END,
        products.name
      LIMIT ${limit}`
    const products = await pool.query(q, params)
    res.json({ success: true, products: products.rows })
  } catch (error) {
    console.log("searchProducts error:", error.message)
    res.status(500).json({ message: error.message })
  }
}
module.exports = searchProducts
