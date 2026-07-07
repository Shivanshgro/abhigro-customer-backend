const pool = require("../../config/db")

// PUT /api/admin/products/:id  — edit any fields (only provided ones)
exports.editProduct = async (req, res) => {
  try {
    const id = req.params.id
    const fields = ["name","description","price","mrp","unit","stock","image",
                    "category_id","subcategory_id","brand_id","availability_scope","scope_value"]
    const sets = []; const params = []
    fields.forEach(f => {
      if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`) }
    })
    if (sets.length === 0) return res.status(400).json({ message: "No fields to update" })
    params.push(id)
    const r = await pool.query(`UPDATE products SET ${sets.join(", ")} WHERE id=$${params.length} RETURNING *`, params)
    if (r.rows.length === 0) return res.status(404).json({ message: "Product not found" })
    res.json({ success: true, product: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/admin/products/:id/toggle  — activate/deactivate
exports.toggleProduct = async (req, res) => {
  try {
    const r = await pool.query(`UPDATE products SET is_active = NOT is_active WHERE id=$1 RETURNING id, name, is_active`, [req.params.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Product not found" })
    res.json({ success: true, product: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/admin/products/:id/availability  { availability_scope, scope_value }
exports.setAvailability = async (req, res) => {
  try {
    const { availability_scope, scope_value } = req.body
    const r = await pool.query(
      `UPDATE products SET availability_scope=$1, scope_value=$2 WHERE id=$3 RETURNING id, name, availability_scope, scope_value`,
      [availability_scope || "global", scope_value || null, req.params.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Product not found" })
    res.json({ success: true, product: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
