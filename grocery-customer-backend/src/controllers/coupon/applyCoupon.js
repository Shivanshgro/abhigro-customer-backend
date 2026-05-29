const pool = require("../../config/db")

const applyCoupon = async (req, res) => {
  try {
    // Frontend sends: { coupon: "CODE" } or { code: "CODE" }
    const code = req.body.coupon || req.body.code

    if (!code) {
      return res.status(400).json({ message: "Coupon code is required" })
    }

    const result = await pool.query(
      `SELECT * FROM coupons WHERE UPPER(code)=UPPER($1) AND active=true`,
      [code]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Invalid or expired coupon" })
    }

    const coupon = result.rows[0]

    res.json({
      success: true,
      coupon: coupon.code,
      discount: coupon.discount_amount || coupon.discount || 0,
      discountPercent: coupon.discount_percent || 0,
      minOrder: coupon.min_order_amount || 0,
    })
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: error.message })
  }
}

module.exports = applyCoupon
