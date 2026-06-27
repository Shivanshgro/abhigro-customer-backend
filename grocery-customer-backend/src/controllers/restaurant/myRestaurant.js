const pool = require("../../config/db")

// GET /api/restaurant/me — the logged-in owner's restaurant + approval status
const myRestaurant = async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM food_restaurants WHERE owner_id=$1`, [req.user.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "No restaurant registered" })
    res.json({ success: true, restaurant: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/restaurant/online  { is_online }
const setOnline = async (req, res) => {
  try {
    const { is_online } = req.body
    const r = await pool.query(
      `UPDATE food_restaurants SET is_online=$1, updated_at=NOW()
       WHERE owner_id=$2 AND is_approved=true RETURNING id, is_online`,
      [!!is_online, req.user.id])
    if (r.rows.length === 0) return res.status(403).json({ message: "Restaurant not found or not approved yet" })
    res.json({ success: true, is_online: r.rows[0].is_online })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

module.exports = { myRestaurant, setOnline }
