// ────────────────────────────────────────────────────────────────────────────
// restaurantSettings.js — profile, hours, staff, and richer menu control.
// Everything scoped to the restaurant the caller owns.
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../../config/db")

async function owned(userId) {
  const r = await pool.query(`SELECT id FROM food_restaurants WHERE owner_id=$1`, [userId])
  return r.rows[0] || null
}

/* ═══════════════════════ PROFILE ═══════════════════════ */

// PUT /api/restaurant/profile
// Only fields a restaurant may safely change. Deliberately excluded:
// commission_percent, is_approved, owner_id, fssai_number — those are AbhiGro's
// or a compliance matter, not a self-service setting.
const EDITABLE = [
  "restaurant_name", "owner_name", "phone", "email", "address",
  "cuisine_type", "food_type", "opening_time", "closing_time",
  "logo_url", "cover_url", "upi_id",
]

exports.updateProfile = async (req, res) => {
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })

    const b = req.body || {}
    const sets = [], vals = [rest.id]
    let n = 2
    for (const k of EDITABLE) {
      if (b[k] !== undefined) {
        sets.push(`${k} = $${n++}`)
        vals.push(b[k] === "" ? null : b[k])
      }
    }
    if (sets.length === 0) return res.status(400).json({ message: "Nothing to update" })

    sets.push("updated_at = NOW()")
    const r = await pool.query(
      `UPDATE food_restaurants SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, vals)
    res.json({ success: true, restaurant: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

/* ═══════════════════════ HOURS ═══════════════════════ */

// GET /api/restaurant/hours  — always returns all seven days
exports.getHours = async (req, res) => {
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `SELECT weekday, open_time, close_time, is_open
       FROM restaurant_hours WHERE restaurant_id=$1 ORDER BY weekday`, [rest.id])
    const byDay = {}
    r.rows.forEach(x => { byDay[x.weekday] = x })
    const hours = [0,1,2,3,4,5,6].map(d => byDay[d] || {
      weekday: d, open_time: null, close_time: null, is_open: true,
    })
    res.json({ success: true, hours })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// PUT /api/restaurant/hours   { hours: [{weekday, open_time, close_time, is_open}] }
exports.setHours = async (req, res) => {
  const client = await pool.connect()
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const rows = (req.body || {}).hours
    if (!Array.isArray(rows)) return res.status(400).json({ message: "Send an hours array" })

    await client.query("BEGIN")
    for (const h of rows) {
      const d = parseInt(h.weekday, 10)
      if (!Number.isInteger(d) || d < 0 || d > 6) continue
      await client.query(
        `INSERT INTO restaurant_hours (restaurant_id, weekday, open_time, close_time, is_open)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (restaurant_id, weekday) DO UPDATE
           SET open_time = EXCLUDED.open_time,
               close_time = EXCLUDED.close_time,
               is_open = EXCLUDED.is_open`,
        [rest.id, d, h.open_time || null, h.close_time || null, h.is_open !== false])
    }
    await client.query("COMMIT")
    res.json({ success: true })
  } catch (e) {
    try { await client.query("ROLLBACK") } catch (_) {}
    res.status(500).json({ message: e.message })
  } finally { client.release() }
}

// POST /api/restaurant/closed-today   { closed }
exports.setClosedToday = async (req, res) => {
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const closed = (req.body || {}).closed === true || (req.body || {}).closed === "true"
    const r = await pool.query(
      `UPDATE food_restaurants SET closed_today=$1, updated_at=NOW()
       WHERE id=$2 RETURNING closed_today`, [closed, rest.id])
    res.json({ success: true, closed_today: r.rows[0].closed_today })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

/* ═══════════════════════ STAFF ═══════════════════════ */

// GET /api/restaurant/staff
exports.getStaff = async (req, res) => {
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `SELECT s.id, s.role, s.is_active, s.created_at,
              u.name, u.phone
       FROM restaurant_staff s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.restaurant_id=$1 ORDER BY s.id`, [rest.id])
    res.json({ success: true, staff: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/restaurant/staff   { phone, role }
// The person must already have an AbhiGro account — we do not create logins here.
exports.addStaff = async (req, res) => {
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const b = req.body || {}
    const phone = String(b.phone || "").replace(/[^0-9]/g, "")
    const role = ["RESTAURANT_MANAGER", "KITCHEN", "CASHIER"].includes(b.role) ? b.role : "KITCHEN"
    if (phone.length < 10) return res.status(400).json({ message: "Enter a valid phone number" })

    const u = await pool.query(`SELECT id, name FROM users WHERE phone=$1`, [phone])
    if (u.rows.length === 0)
      return res.status(404).json({ message: "No AbhiGro account with that number. Ask them to sign up first." })

    const dup = await pool.query(
      `SELECT id FROM restaurant_staff WHERE restaurant_id=$1 AND user_id=$2`, [rest.id, u.rows[0].id])
    if (dup.rows.length > 0) return res.status(409).json({ message: "They are already on your team" })

    const r = await pool.query(
      `INSERT INTO restaurant_staff (user_id, role, restaurant_id, is_active)
       VALUES ($1,$2,$3,true) RETURNING *`, [u.rows[0].id, role, rest.id])
    res.json({ success: true, staff: { ...r.rows[0], name: u.rows[0].name, phone } })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// DELETE /api/restaurant/staff/:id
exports.removeStaff = async (req, res) => {
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `DELETE FROM restaurant_staff WHERE id=$1 AND restaurant_id=$2 RETURNING id`,
      [req.params.id, rest.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Not found" })
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

/* ═══════════════════════ MENU EXTRAS ═══════════════════════ */

// POST /api/restaurant/item/:id/flags
// bestseller, daily limit, and "off until" in one place.
exports.setItemFlags = async (req, res) => {
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const b = req.body || {}
    const sets = [], vals = [req.params.id, rest.id]
    let n = 3

    if (b.is_bestseller !== undefined) { sets.push(`is_bestseller = $${n++}`); vals.push(!!b.is_bestseller) }
    if (b.daily_limit !== undefined) {
      const v = b.daily_limit === "" || b.daily_limit === null ? null : parseInt(b.daily_limit, 10)
      sets.push(`daily_limit = $${n++}`); vals.push(Number.isFinite(v) ? v : null)
    }
    if (b.out_until !== undefined) {
      // "off until tonight" = out_until set, is_available false.
      // "back on" = clear both.
      sets.push(`out_until = $${n++}`); vals.push(b.out_until || null)
      sets.push(`is_available = $${n++}`); vals.push(!b.out_until)
    }
    if (sets.length === 0) return res.status(400).json({ message: "Nothing to update" })

    sets.push("updated_at = NOW()")
    const r = await pool.query(
      `UPDATE food_items SET ${sets.join(", ")} WHERE id=$1 AND restaurant_id=$2 RETURNING *`, vals)
    if (r.rows.length === 0) return res.status(404).json({ message: "Dish not found" })
    res.json({ success: true, item: r.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/restaurant/item/:id/move   { direction: "up" | "down" }
// Swaps sort_order with the neighbour. Simpler than drag and drop, and it works
// on a phone in a kitchen, which drag and drop does not.
exports.moveItem = async (req, res) => {
  const client = await pool.connect()
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const dir = (req.body || {}).direction === "up" ? "up" : "down"

    await client.query("BEGIN")
    const cur = await client.query(
      `SELECT id, category_id, COALESCE(sort_order,0) AS sort_order
       FROM food_items WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`, [req.params.id, rest.id])
    if (cur.rows.length === 0) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Dish not found" }) }
    const it = cur.rows[0]

    const nb = await client.query(
      `SELECT id, COALESCE(sort_order,0) AS sort_order FROM food_items
       WHERE restaurant_id=$1 AND is_active=true
         AND COALESCE(category_id,0) = COALESCE($2,0)
         AND COALESCE(sort_order,0) ${dir === "up" ? "<" : ">"} $3
       ORDER BY COALESCE(sort_order,0) ${dir === "up" ? "DESC" : "ASC"} LIMIT 1`,
      [rest.id, it.category_id, it.sort_order])

    if (nb.rows.length === 0) { await client.query("COMMIT"); return res.json({ success: true, note: "Already at the end" }) }

    await client.query(`UPDATE food_items SET sort_order=$1 WHERE id=$2`, [nb.rows[0].sort_order, it.id])
    await client.query(`UPDATE food_items SET sort_order=$1 WHERE id=$2`, [it.sort_order, nb.rows[0].id])
    await client.query("COMMIT")
    res.json({ success: true })
  } catch (e) {
    try { await client.query("ROLLBACK") } catch (_) {}
    res.status(500).json({ message: e.message })
  } finally { client.release() }
}

/* ═══════════════════════ OPTION GROUPS ═══════════════════════ */

// GET /api/restaurant/item/:id/options
exports.getItemOptions = async (req, res) => {
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const own = await pool.query(
      `SELECT id FROM food_items WHERE id=$1 AND restaurant_id=$2`, [req.params.id, rest.id])
    if (own.rows.length === 0) return res.status(404).json({ message: "Dish not found" })

    const g = await pool.query(
      `SELECT * FROM food_item_option_groups WHERE item_id=$1 ORDER BY sort_order, id`, [req.params.id])
    const o = await pool.query(
      `SELECT o.* FROM food_item_options o
       JOIN food_item_option_groups g ON g.id = o.group_id
       WHERE g.item_id=$1 ORDER BY o.sort_order, o.id`, [req.params.id])

    const groups = g.rows.map(x => ({ ...x, options: o.rows.filter(y => y.group_id === x.id) }))
    res.json({ success: true, groups })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/restaurant/item/:id/options   { name, is_required, is_multi, options:[{name, price_delta}] }
exports.addItemOptionGroup = async (req, res) => {
  const client = await pool.connect()
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const own = await pool.query(
      `SELECT id FROM food_items WHERE id=$1 AND restaurant_id=$2`, [req.params.id, rest.id])
    if (own.rows.length === 0) return res.status(404).json({ message: "Dish not found" })

    const b = req.body || {}
    const name = String(b.name || "").trim()
    if (!name) return res.status(400).json({ message: "The group needs a name" })
    const opts = Array.isArray(b.options) ? b.options.filter(o => String(o.name || "").trim()) : []
    if (opts.length === 0) return res.status(400).json({ message: "Add at least one choice" })

    await client.query("BEGIN")
    const g = await client.query(
      `INSERT INTO food_item_option_groups (item_id, name, is_required, is_multi, sort_order)
       VALUES ($1,$2,$3,$4,COALESCE((SELECT MAX(sort_order)+1 FROM food_item_option_groups WHERE item_id=$1),0))
       RETURNING *`,
      [req.params.id, name, b.is_required === true || b.is_required === "true",
       b.is_multi === true || b.is_multi === "true"])

    for (let i = 0; i < opts.length; i++) {
      await client.query(
        `INSERT INTO food_item_options (group_id, name, price_delta, sort_order)
         VALUES ($1,$2,$3,$4)`,
        [g.rows[0].id, String(opts[i].name).trim(), Number(opts[i].price_delta) || 0, i])
    }
    await client.query("COMMIT")
    res.json({ success: true, group: g.rows[0] })
  } catch (e) {
    try { await client.query("ROLLBACK") } catch (_) {}
    res.status(500).json({ message: e.message })
  } finally { client.release() }
}

// DELETE /api/restaurant/options/:groupId
exports.deleteOptionGroup = async (req, res) => {
  try {
    const rest = await owned(req.user.id)
    if (!rest) return res.status(403).json({ message: "No restaurant" })
    const r = await pool.query(
      `DELETE FROM food_item_option_groups g
       USING food_items i
       WHERE g.id=$1 AND g.item_id=i.id AND i.restaurant_id=$2
       RETURNING g.id`, [req.params.groupId, rest.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Not found" })
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}
