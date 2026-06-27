const pool = require("../../config/db")

// GET /api/food/restaurants?pincode=&lat=&lng=
// ONLY approved restaurants. Online ones first. Unapproved are NEVER returned.
exports.nearbyRestaurants = async (req, res) => {
  try {
    const { pincode } = req.query
    let q = `SELECT id, restaurant_name, address, latitude, longitude, pincode,
                    food_type, cuisine_type, opening_time, closing_time,
                    is_online, rating, restaurant_images, fssai_number
             FROM food_restaurants
             WHERE is_approved=true AND approval_status='approved'`
    const params = []
    if (pincode) { params.push(pincode); q += ` AND pincode=$${params.length}` }
    q += ` ORDER BY is_online DESC, rating DESC, id DESC`
    const r = await pool.query(q, params)
    res.json({ success: true, restaurants: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/food/restaurants/:id/menu — public menu for an approved restaurant
exports.restaurantMenu = async (req, res) => {
  try {
    const rest = await pool.query(
      `SELECT id, restaurant_name, address, food_type, cuisine_type, opening_time, closing_time,
              is_online, rating, restaurant_images, fssai_number
       FROM food_restaurants WHERE id=$1 AND is_approved=true`, [req.params.id])
    if (rest.rows.length === 0) return res.status(404).json({ message: "Restaurant not found" })
    const cats = await pool.query(`SELECT id,name FROM food_categories WHERE restaurant_id=$1 AND is_active=true ORDER BY id`, [req.params.id])
    const items = await pool.query(
      `SELECT id, category_id, name, description, price, image, food_type, preparation_time, is_available
       FROM food_items WHERE restaurant_id=$1 AND is_active=true ORDER BY category_id, name`, [req.params.id])
    res.json({ success: true, restaurant: rest.rows[0], categories: cats.rows, items: items.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
