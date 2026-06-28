const pool = require("../../config/db")

async function resolveCategoryId(name, id) {
  if (id) return id
  if (!name) return null
  let r = await pool.query(`SELECT id FROM categories WHERE LOWER(name)=LOWER($1) LIMIT 1`, [name])
  if (r.rows.length === 0) r = await pool.query(`INSERT INTO categories (name) VALUES ($1) RETURNING id`, [name])
  return r.rows[0].id
}
async function resolveSubcategoryId(name, id, category_id) {
  if (id) return id
  if (!name) return null
  let r = await pool.query(`SELECT id FROM subcategories WHERE LOWER(name)=LOWER($1) AND category_id=$2 LIMIT 1`, [name, category_id])
  if (r.rows.length === 0) r = await pool.query(`INSERT INTO subcategories (name, category_id) VALUES ($1,$2) RETURNING id`, [name, category_id])
  return r.rows[0].id
}
async function resolveBrandId(name, id) {
  if (id) return id
  if (!name || !String(name).trim()) return null // brand optional
  let r = await pool.query(`SELECT id FROM brands WHERE LOWER(name)=LOWER($1) LIMIT 1`, [name])
  if (r.rows.length === 0) r = await pool.query(`INSERT INTO brands (name) VALUES ($1) RETURNING id`, [name])
  return r.rows[0].id
}

const addProduct = async (req, res) => {
  try {
    const {
      name, description, price, mrp, unit, stock, image,
      category_id, category, subcategory_id, subcategory,
      brand_id, brand, availability_scope, scope_value
    } = req.body

    if (!name || !price) return res.status(400).json({ message: "name and price are required" })

    const catId = await resolveCategoryId(category, category_id)
    if (!catId) return res.status(400).json({ message: "category is required" })
    const subId = await resolveSubcategoryId(subcategory, subcategory_id, catId)
    const brId = await resolveBrandId(brand, brand_id)

    const result = await pool.query(
      `INSERT INTO products
         (name, description, price, mrp, unit, stock, image, category_id,
          subcategory_id, brand_id, availability_scope, scope_value, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING *`,
      [name, description || "", price, mrp || price, unit || "", stock || 0, image || "",
       catId, subId, brId, availability_scope || "global", scope_value || null]
    )
    res.json({ success: true, product: result.rows[0] })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}
module.exports = addProduct
