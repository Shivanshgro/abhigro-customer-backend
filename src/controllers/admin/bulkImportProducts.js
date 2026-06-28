const pool = require("../config/db")

module.exports = async (req, res) => {
  try {
    const products = req.body.products
    if (!Array.isArray(products) || products.length === 0)
      return res.status(400).json({ success: false, message: "No products provided" })

    let inserted = 0
    for (const p of products) {
      await pool.query(
        INSERT INTO products (name, price, category_id, subcategory_id, brand_id, stock, is_active)
         VALUES (,,,,,,true)
         ON CONFLICT DO NOTHING,
        [p.name, p.price, p.category_id, p.subcategory_id, p.brand_id, p.stock ?? 0]
      )
      inserted++
    }

    res.json({ success: true, inserted })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}
