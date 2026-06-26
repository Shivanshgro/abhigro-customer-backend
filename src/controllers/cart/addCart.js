const pool = require("../../config/db")

const addCart = async (req, res) => {
  try {
    // Accept both productId and product_id from frontend
    const { productId, product_id, quantity = 1 } = req.body
    const pid = productId || product_id
    
    // Get user_id from JWT token
    const user_id = req.user?.id

    if (!pid) {
      return res.status(400).json({ message: "productId is required" })
    }

    if (!user_id) {
      return res.status(401).json({ message: "Please login to add to cart" })
    }

    // Get or create cart for user
    const cart = await pool.query(
      `SELECT * FROM cart WHERE user_id=$1`,
      [user_id]
    )

    let cartId

    if (cart.rows.length === 0) {
      const newCart = await pool.query(
        `INSERT INTO cart (user_id) VALUES($1) RETURNING id`,
        [user_id]
      )
      cartId = newCart.rows[0].id
    } else {
      cartId = cart.rows[0].id
    }

    // Check if product already in cart
    const existing = await pool.query(
      `SELECT * FROM cart_items WHERE cart_id=$1 AND product_id=$2`,
      [cartId, pid]
    )

    if (existing.rows.length > 0) {
      // Update quantity
      await pool.query(
        `UPDATE cart_items SET quantity = quantity + $1 WHERE cart_id=$2 AND product_id=$3`,
        [quantity, cartId, pid]
      )
    } else {
      // Insert new item
      await pool.query(
        `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES($1,$2,$3)`,
        [cartId, pid, quantity]
      )
    }

    res.json({ success: true, message: "Added To Cart" })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = addCart