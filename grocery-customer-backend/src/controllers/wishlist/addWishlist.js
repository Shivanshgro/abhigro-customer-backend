const pool = require("../../config/db")

const addWishlist = async (req, res) => {
  try {
    const user_id = req.user.id
    const { productId, product_id } = req.body
    const pid = productId || product_id

    if (!pid) return res.status(400).json({ message: "productId required" })

    // Check if already in wishlist
    const existing = await pool.query(
      `SELECT id FROM wishlist WHERE user_id=$1 AND product_id=$2`,
      [user_id, pid]
    )

    if (existing.rows.length > 0) {
      return res.json({ success: true, message: "Already in wishlist" })
    }

    await pool.query(
      `INSERT INTO wishlist(user_id, product_id) VALUES($1,$2)`,
      [user_id, pid]
    )

    res.json({ success: true, message: "Added To Wishlist" })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = addWishlist