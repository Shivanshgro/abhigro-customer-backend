const express = require("express")
const router = express.Router()
const auth = require("../middleware/auth")
const pool = require("../config/db")

// POST /api/cart — add item (frontend sends productId)
router.post("/", auth, async (req, res) => {
  try {
    const { productId, product_id, quantity = 1 } = req.body
    const pid = productId || product_id // accept both spellings

    if (!pid) {
      return res.status(400).json({ message: "productId is required" })
    }

    // Upsert: if already in cart, increase quantity
    const existing = await pool.query(
      `SELECT id, quantity FROM cart WHERE user_id=$1 AND product_id=$2`,
      [req.user.id, pid]
    )

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE cart SET quantity = quantity + $1 WHERE id=$2`,
        [quantity, existing.rows[0].id]
      )
    } else {
      await pool.query(
        `INSERT INTO cart(user_id, product_id, quantity) VALUES($1,$2,$3)`,
        [req.user.id, pid, quantity]
      )
    }

    res.json({ success: true, message: "Added To Cart" })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: "Server Error" })
  }
})

// GET /api/cart — get current user's cart
router.get("/", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        cart.id,
        cart.quantity,
        products.id AS product_id,
        products.name,
        products.price,
        products.image
       FROM cart
       JOIN products ON cart.product_id = products.id
       WHERE cart.user_id = $1`,
      [req.user.id]
    )
    res.json({ success: true, cart: result.rows })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: "Server Error" })
  }
})

// PUT /api/cart/:id — update quantity
router.put("/:id", auth, async (req, res) => {
  try {
    const { quantity } = req.body
    const result = await pool.query(
      `UPDATE cart SET quantity=$1 WHERE id=$2 AND user_id=$3 RETURNING *`,
      [quantity, req.params.id, req.user.id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Cart item not found" })
    }
    res.json({ success: true, item: result.rows[0] })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: "Server Error" })
  }
})

// DELETE /api/cart/:id — remove item
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM cart WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    )
    res.json({ success: true, message: "Removed" })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: "Server Error" })
  }
})

module.exports = router
