const express = require("express")
const router = express.Router()
const auth = require("../middleware/auth")
const applyCoupon = require("../controllers/coupon/applyCoupon")
const pool = require("../config/db")

// GET all active coupons — auth required so codes aren't publicly exposed
router.get("/", auth, async (req, res) => {
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

router.post("/apply", auth, applyCoupon)

module.exports = router
