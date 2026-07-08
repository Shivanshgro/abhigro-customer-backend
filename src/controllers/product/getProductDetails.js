const pool = require("../../config/db")

const getProductDetails = async (req, res) => {
  try {
    const { id } = req.params

    const product = await pool.query(
      `SELECT products.*, categories.name AS category,
              subcategories.name AS subcategory_name, brands.name AS brand_name
       FROM products
       LEFT JOIN categories ON products.category_id = categories.id
       LEFT JOIN subcategories ON products.subcategory_id = subcategories.id
       LEFT JOIN brands ON products.brand_id = brands.id
       WHERE products.id=$1`,
      [id]
    )

    if (product.rows.length === 0) {
      return res.status(404).json({ message: "Product Not Found" })
    }

    // similar products (same subcategory first, else same category)
    let similar = []
    try {
      const row = product.rows[0]
      const sim = await pool.query(
        `SELECT products.*, brands.name AS brand_name FROM products
         LEFT JOIN brands ON products.brand_id = brands.id
         WHERE products.is_active = true AND products.id <> $1
           AND (products.subcategory_id = $2 OR ($2 IS NULL AND products.category_id = $3))
         ORDER BY (products.subcategory_id = $2) DESC, products.id DESC LIMIT 8`,
        [id, row.subcategory_id, row.category_id])
      similar = sim.rows
    } catch (e) {}

    res.json({ ...product.rows[0], similar })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = getProductDetails
