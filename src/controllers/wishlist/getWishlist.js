const pool = require("../../config/db")

const getWishlist = async (req, res) => {
  try {
    const user_id = req.user.id

    const items = await pool.query(
      `SELECT wishlist.id, products.id AS product_id, products.name, products.price, products.image
       FROM wishlist
       JOIN products ON products.id = wishlist.product_id
       WHERE wishlist.user_id=$1`,
      [user_id]
    )

    res.json(items.rows)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}
module.exports = getWishlist
