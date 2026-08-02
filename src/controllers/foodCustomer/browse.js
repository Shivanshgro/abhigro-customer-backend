const pool = require("../../config/db")

// GET /api/food/restaurants?pincode=&lat=&lng=
// Radius-based discovery: if lat/lng given, show approved restaurants that DELIVER
// to the customer (distance <= their delivery_radius_km), nearest first.
// Falls back to pincode match if no lat/lng (keeps old behaviour = backward compatible).
// ONLY approved restaurants. Online first. Unapproved NEVER returned.
exports.nearbyRestaurants = async (req, res) => {
  try {
    const { pincode } = req.query
    const lat = parseFloat(req.query.lat)
    const lng = parseFloat(req.query.lng)
    const hasGeo = !isNaN(lat) && !isNaN(lng)

    if (hasGeo) {
      // Radius-based: Haversine distance, keep only those within their delivery radius.
      const params = [lng, lat]
      const q = `
        SELECT * FROM (
          SELECT id, restaurant_name, address, latitude, longitude, pincode,
                 food_type, cuisine_type, opening_time, closing_time,
                 is_online, rating, restaurant_images, fssai_number,
                 COALESCE(delivery_radius_km, 5) AS delivery_radius_km,
                 (6371 * acos(
                    LEAST(1, GREATEST(-1,
                      cos(radians($2)) * cos(radians(latitude)) *
                      cos(radians(longitude) - radians($1)) +
                      sin(radians($2)) * sin(radians(latitude))
                    ))
                 )) AS distance_km
          FROM food_restaurants
          WHERE is_approved = true AND approval_status = 'approved'
            AND latitude IS NOT NULL AND longitude IS NOT NULL
        ) t
        WHERE t.distance_km <= t.delivery_radius_km
        ORDER BY t.is_online DESC, t.distance_km ASC, t.rating DESC
        LIMIT 50`
      const r = await pool.query(q, params)
      return res.json({ success: true, restaurants: r.rows, mode: "radius" })
    }

    // Fallback (no GPS): original pincode behaviour — unchanged, backward compatible.
    let q = `SELECT id, restaurant_name, address, latitude, longitude, pincode,
                    food_type, cuisine_type, opening_time, closing_time,
                    is_online, rating, restaurant_images, fssai_number
             FROM food_restaurants
             WHERE is_approved=true AND approval_status='approved'`
    const params = []
    if (pincode) { params.push(pincode); q += ` AND pincode=$${params.length}` }
    q += ` ORDER BY is_online DESC, rating DESC, id DESC`
    const r = await pool.query(q, params)
    res.json({ success: true, restaurants: r.rows, mode: "pincode" })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/food/restaurants/:id/menu — public menu for an approved restaurant (UNCHANGED)
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