const pool = require("../../config/db")

async function ownedRestaurant(userId) {
  const r = await pool.query(`SELECT id FROM food_restaurants WHERE owner_id=$1`, [userId])
  return r.rows[0] || null
}

// ---- Categories ----
exports.addCategory = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const { name } = req.body
    if (!name) return res.status(400).json({ message: "Category name required" })
    const r = await pool.query(`INSERT INTO food_categories(restaurant_id,name) VALUES($1,$2) RETURNING *`, [rest.id, name])
    res.json({ success: true, category: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
exports.getCategories = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(`SELECT * FROM food_categories WHERE restaurant_id=$1 AND is_active=true ORDER BY id`, [rest.id])
    res.json({ success: true, categories: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
exports.deleteCategory = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    await pool.query(`UPDATE food_categories SET is_active=false WHERE id=$1 AND restaurant_id=$2`, [req.params.id, rest.id])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---- Items ----
exports.addItem = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const { category_id, name, description, price, image, food_type, preparation_time } = req.body
    if (!name || price == null) return res.status(400).json({ message: "Name and price required" })
    const r = await pool.query(
      `INSERT INTO food_items(restaurant_id,category_id,name,description,price,image,food_type,preparation_time)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [rest.id, category_id||null, name, description||null, price, image||null, food_type||null, preparation_time||null])
    res.json({ success: true, item: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
exports.editItem = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const { name, description, price, image, food_type, preparation_time, category_id } = req.body
    const r = await pool.query(
      `UPDATE food_items SET
         name=COALESCE($1,name), description=COALESCE($2,description), price=COALESCE($3,price),
         image=COALESCE($4,image), food_type=COALESCE($5,food_type),
         preparation_time=COALESCE($6,preparation_time), category_id=COALESCE($7,category_id)
       WHERE id=$8 AND restaurant_id=$9 RETURNING *`,
      [name,description,price,image,food_type,preparation_time,category_id,req.params.id,rest.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Item not found" })
    res.json({ success: true, item: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
exports.setAvailability = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const { is_available } = req.body
    const r = await pool.query(`UPDATE food_items SET is_available=$1 WHERE id=$2 AND restaurant_id=$3 RETURNING id,is_available`,
      [!!is_available, req.params.id, rest.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Item not found" })
    res.json({ success: true, item: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
exports.deleteItem = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    await pool.query(`UPDATE food_items SET is_active=false WHERE id=$1 AND restaurant_id=$2`, [req.params.id, rest.id])
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
exports.getMyItems = async (req, res) => {
  try {
    const rest = await ownedRestaurant(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(`SELECT * FROM food_items WHERE restaurant_id=$1 AND is_active=true ORDER BY category_id, name`, [rest.id])
    res.json({ success: true, items: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
