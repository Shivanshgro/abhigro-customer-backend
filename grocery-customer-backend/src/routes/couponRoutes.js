const express = require("express")
const router = express.Router()
const applyCoupon = require("../controllers/coupon/applyCoupon")
const pool = require("../config/db")

// GET all active coupons
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, description, discount_amount AS discount, discount_percent, min_order_amount AS "minOrder"
       FROM coupons WHERE active=true ORDER BY id DESC`
    )
    res.json(result.rows)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

router.post("/apply", applyCoupon)

module.exports = router
