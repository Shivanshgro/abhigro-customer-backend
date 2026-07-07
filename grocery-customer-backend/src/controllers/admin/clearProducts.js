const pool = require("../../config/db")

// POST /api/admin/products/clear  { mode: "deactivate" | "delete" }
// deactivate (default, SAFE): sets is_active=false on all products — they vanish from the app but data is kept.
// delete (DANGER): hard-removes products that have NO order history.
const clearProducts = async (req, res) => {
  try {
    const mode = (req.body && req.body.mode) || "deactivate"
    if (mode === "delete") {
      // only delete products never ordered (safe); keep ones referenced by order_items
      const r = await pool.query(
        `DELETE FROM products WHERE id NOT IN (SELECT DISTINCT product_id FROM order_items) RETURNING id`)
      return res.json({ success: true, mode, deleted: r.rowCount })
    }
    const r = await pool.query(`UPDATE products SET is_active=false RETURNING id`)
    res.json({ success: true, mode: "deactivate", deactivated: r.rowCount })
  } catch (e) {
    console.log("clearProducts error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = clearProducts
