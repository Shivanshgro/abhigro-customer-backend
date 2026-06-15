const pool = require("../../config/db")

// POST /api/supplier/sync
// Suppliers push their catalog here — prices, stock, images all auto-update
const supplierSync = async (req, res) => {
  const client = await pool.connect()
  try {
    const { supplier_id, products } = req.body
    if (!supplier_id || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: "supplier_id and products[] required" })
    }

    let updated = 0, inserted = 0, outOfStock = 0
    await client.query("BEGIN")

    for (const item of products) {
      const { sku, name, price, mrp, stock, image, unit, category_id } = item
      if (!sku || !name || price === undefined) continue

      const isActive = Number(stock) > 0
      if (!isActive) outOfStock++

      const existing = await client.query(`SELECT id FROM products WHERE sku=$1`, [sku])

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE products SET name=$1, price=$2, mrp=COALESCE($3,price),
           stock=$4, image=COALESCE(NULLIF($5,''),image),
           unit=COALESCE(NULLIF($6,''),unit), is_active=$7, updated_at=NOW()
           WHERE sku=$8`,
          [name, price, mrp, stock||0, image, unit, isActive, sku]
        )
        updated++
      } else {
        await client.query(
          `INSERT INTO products(sku,name,price,mrp,stock,image,unit,category_id,is_active,supplier_id,created_at,updated_at)
           VALUES($1,$2,$3,COALESCE($4,$3),$5,COALESCE($6,''),$7,COALESCE($8,1),$9,$10,NOW(),NOW())`,
          [sku, name, price, mrp, stock||0, image, unit||"", category_id||1, isActive, supplier_id]
        )
        inserted++
      }
    }

    await client.query("COMMIT")
    res.json({ success:true, updated, inserted, outOfStock, total:products.length })
  } catch (error) {
    await client.query("ROLLBACK")
    res.status(500).json({ message: error.message })
  } finally {
    client.release()
  }
}
module.exports = supplierSync
