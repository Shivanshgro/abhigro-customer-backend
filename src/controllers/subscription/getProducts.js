const pool = require("../../config/db")

const getSubscriptionProducts = async (req, res) => {
  try {
    const products = await pool.query(
      `SELECT id, name, price, unit FROM products 
       WHERE LOWER(name) IN ('milk', 'curd', 'eggs', 'bread') AND stock > 0
       ORDER BY name`
    )
    res.json({ products: products.rows })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

module.exports = getSubscriptionProducts