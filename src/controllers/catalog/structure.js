const pool = require("../../config/db")

// GET /api/catalog/categories  -> categories with their subcategories
exports.getCategories = async (req, res) => {
  try {
    const cats = await pool.query(`SELECT id, name FROM categories ORDER BY id`)
    const subs = await pool.query(`SELECT id, name, category_id, requires_brand FROM subcategories ORDER BY name`)
    const byCat = {}
    subs.rows.forEach(s => { (byCat[s.category_id] ||= []).push(s) })
    const result = cats.rows.map(c => ({ ...c, subcategories: byCat[c.id] || [] }))
    res.json({ success: true, categories: result })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/catalog/brands?subcategory_id=&category_id=  -> brands (optionally those used in a subcat)
exports.getBrands = async (req, res) => {
  try {
    const { subcategory_id } = req.query
    if (subcategory_id) {
      const r = await pool.query(`
        SELECT DISTINCT b.id, b.name, b.is_local FROM brands b
        JOIN products p ON p.brand_id = b.id
        WHERE p.subcategory_id = $1 AND p.is_active = true
        ORDER BY b.name`, [subcategory_id])
      return res.json({ success: true, brands: r.rows })
    }
    const r = await pool.query(`SELECT id, name, is_local FROM brands ORDER BY name`)
    res.json({ success: true, brands: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/catalog/subcategories?category_id=
exports.getSubcategories = async (req, res) => {
  try {
    const { category_id } = req.query
    const r = category_id
      ? await pool.query(`SELECT id, name, category_id, requires_brand FROM subcategories WHERE category_id=$1 ORDER BY name`, [category_id])
      : await pool.query(`SELECT id, name, category_id, requires_brand FROM subcategories ORDER BY name`)
    res.json({ success: true, subcategories: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
