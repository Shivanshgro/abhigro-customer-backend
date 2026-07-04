const pool = require("../../config/db")

const CITY_STATE = {
  "bangalore":"Karnataka","bengaluru":"Karnataka","mysore":"Karnataka","mysuru":"Karnataka",
  "mangalore":"Karnataka","hubli":"Karnataka","belgaum":"Karnataka",
  "pune":"Maharashtra","mumbai":"Maharashtra","nagpur":"Maharashtra",
  "chennai":"Tamil Nadu","coimbatore":"Tamil Nadu",
  "hyderabad":"Telangana","delhi":"Delhi","new delhi":"Delhi",
}

const getProducts = async (req, res) => {
  try {
    const { category, subcategory, subcategory_id, brand_id, city, pincode, state: stateParam, limit = 200, page = 1 } = req.query
    const offset = (page - 1) * limit
    const cityNorm = city ? String(city).trim().toLowerCase() : null
    const state = stateParam || (cityNorm ? CITY_STATE[cityNorm] : null)

    let q = `
      SELECT products.*, categories.name AS category_name,
             subcategories.name AS subcategory_name,
             brands.name AS brand_name
      FROM products
      LEFT JOIN categories ON products.category_id = categories.id
      LEFT JOIN subcategories ON products.subcategory_id = subcategories.id
      LEFT JOIN brands ON products.brand_id = brands.id
      WHERE products.is_active = true
    `
    const params = []

    // location scope
    const scope = ["products.availability_scope = 'global'", "products.availability_scope IS NULL"]
    if (state)   { params.push(state);   scope.push(`(products.availability_scope='state' AND LOWER(products.scope_value)=LOWER($${params.length}))`) }
    if (city)    { params.push(city);    scope.push(`(products.availability_scope='city' AND LOWER(products.scope_value)=LOWER($${params.length}))`) }
    if (pincode) { params.push(pincode); scope.push(`(products.availability_scope='pincode' AND products.scope_value=$${params.length})`) }
    q += ` AND (${scope.join(" OR ")})`

    if (category)       { params.push(category);       q += ` AND LOWER(categories.name)=LOWER($${params.length})` }
    if (subcategory)    { params.push(subcategory);    q += ` AND LOWER(subcategories.name)=LOWER($${params.length})` }
    if (subcategory_id) { params.push(subcategory_id); q += ` AND products.subcategory_id=$${params.length}` }
    if (brand_id)       { params.push(brand_id);       q += ` AND products.brand_id=$${params.length}` }

    params.push(limit, offset)
    q += ` ORDER BY products.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`

    const products = await pool.query(q, params)
    res.json({ success: true, products: products.rows })
  } catch (error) {
    console.log("getProducts error:", error.message)
    res.status(500).json({ message: error.message })
  }
}
module.exports = getProducts
