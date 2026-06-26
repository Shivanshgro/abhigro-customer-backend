const pool = require("../../config/db")

// POST /api/products/:id/reviews  { rating, comment }
// verified = user has a delivered/completed order containing this product.
const addReview = async (req, res) => {
  try {
    const userId = req.user.id
    const productId = req.params.id
    const { rating, comment } = req.body
    const r = parseInt(rating, 10)
    if (!r || r < 1 || r > 5) return res.status(400).json({ message: "Rating must be 1–5" })

    const purchased = await pool.query(
      `SELECT 1 FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.user_id=$1 AND oi.product_id=$2
         AND o.status IN ('Delivered','Completed') LIMIT 1`,
      [userId, productId]
    )
    const verified = purchased.rows.length > 0

    await pool.query(
      `INSERT INTO product_reviews(product_id, user_id, rating, comment, verified)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, product_id)
       DO UPDATE SET rating=EXCLUDED.rating, comment=EXCLUDED.comment,
                     verified=EXCLUDED.verified, created_at=NOW()`,
      [productId, userId, r, comment || null, verified]
    )
    res.json({ success: true, verified })
  } catch (e) {
    console.log("addReview error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = addReview
