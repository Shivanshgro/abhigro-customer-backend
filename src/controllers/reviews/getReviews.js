const pool = require("../../config/db")

// GET /api/products/:id/reviews  -> { average, count, distribution, reviews:[] }
const getReviews = async (req, res) => {
  try {
    const productId = req.params.id
    const list = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.verified, r.created_at,
              u.name AS user_name
       FROM product_reviews r LEFT JOIN users u ON u.id=r.user_id
       WHERE r.product_id=$1 ORDER BY r.created_at DESC LIMIT 100`,
      [productId]
    )
    const agg = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(AVG(rating),0)::numeric(3,2) AS average
       FROM product_reviews WHERE product_id=$1`, [productId]
    )
    res.json({
      average: Number(agg.rows[0].average),
      count: agg.rows[0].count,
      reviews: list.rows,
    })
  } catch (e) {
    console.log("getReviews error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = getReviews
