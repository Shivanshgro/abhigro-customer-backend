const pool = require("../../config/db")

// POST /api/admin/products/bulk-import
// Body: { products: [ { name, category, unit, mrp, price, stock, image, description } ] }
// - category is a NAME (e.g. "Beverages"); we find or create it -> category_id
// - price = your selling price; mrp = printed MRP (defaults to price if blank)
// Validates each row; imports valid ones; returns a per-row report.
const bulkImportProducts = async (req, res) => {
  try {
    const { products } = req.body
    if (!Array.isArray(products) || products.length === 0)
      return res.status(400).json({ message: "No products provided" })

    const results = { imported: 0, failed: 0, errors: [] }
    const catCache = {}

    async function getCategoryId(name) {
      const key = (name || "Uncategorized").trim()
      if (catCache[key]) return catCache[key]
      let r = await pool.query(`SELECT id FROM categories WHERE LOWER(name)=LOWER($1) LIMIT 1`, [key])
      if (r.rows.length === 0) {
        r = await pool.query(`INSERT INTO categories (name) VALUES ($1) RETURNING id`, [key])
      }
      catCache[key] = r.rows[0].id
      return catCache[key]
    }

    for (let i = 0; i < products.length; i++) {
      const p = products[i]
      const rowNum = i + 2 // +2 because row 1 is the header in the sheet
      try {
        if (!p.name || String(p.name).trim() === "") { throw new Error("name is required") }
        const price = Number(p.price)
        if (!price || price <= 0) { throw new Error("price must be a positive number") }
        const mrp = p.mrp ? Number(p.mrp) : price
        const stock = p.stock ? parseInt(p.stock, 10) : 0
        const category_id = await getCategoryId(p.category)

        // upsert by name+category to avoid duplicates on re-import
        const existing = await pool.query(
          `SELECT id FROM products WHERE LOWER(name)=LOWER($1) AND category_id=$2 LIMIT 1`,
          [String(p.name).trim(), category_id])

        if (existing.rows.length > 0) {
          await pool.query(
            `UPDATE products SET description=$1, price=$2, mrp=$3, unit=$4, stock=$5, image=$6, is_active=true
             WHERE id=$7`,
            [p.description || "", price, mrp, p.unit || "", stock, p.image || "", existing.rows[0].id])
        } else {
          await pool.query(
            `INSERT INTO products (name, description, price, mrp, unit, stock, image, category_id, is_active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
            [String(p.name).trim(), p.description || "", price, mrp, p.unit || "", stock, p.image || "", category_id])
        }
        results.imported++
      } catch (e) {
        results.failed++
        results.errors.push({ row: rowNum, name: p.name || "(blank)", error: e.message })
      }
    }

    res.json({ success: true, ...results })
  } catch (e) {
    console.log("bulkImportProducts error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = bulkImportProducts
