const pool = require("../../config/db")

// GET /api/group-buy?pincode=560034  — list open group orders for an area
exports.listGroupOrders = async (req, res) => {
  try {
    const { pincode } = req.query
    const params = []
    let q = `SELECT g.*,
               (SELECT COUNT(*) FROM group_order_members m WHERE m.group_order_id = g.id) AS members
             FROM group_orders g
             WHERE g.status = 'open'`
    if (pincode) { params.push(pincode); q += ` AND g.pincode = $${params.length}` }
    q += ` ORDER BY g.closes_at ASC`
    const result = await pool.query(q, params)
    res.json({ success: true, groups: result.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// GET /api/group-buy/:id — full details + members
exports.getGroupOrder = async (req, res) => {
  try {
    const { id } = req.params
    const g = await pool.query(`SELECT * FROM group_orders WHERE id=$1`, [id])
    if (g.rows.length === 0) return res.status(404).json({ message: "Group order not found" })
    const members = await pool.query(
      `SELECT m.*, u.name AS member_name FROM group_order_members m
       LEFT JOIN users u ON u.id = m.user_id WHERE m.group_order_id=$1`, [id])
    res.json({ success: true, group: g.rows[0], members: members.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/group-buy — create a new group order (any user can start one)
exports.createGroupOrder = async (req, res) => {
  try {
    const { title, pincode, building_name, min_amount, closes_at } = req.body
    if (!title || !pincode) return res.status(400).json({ message: "title and pincode required" })
    const result = await pool.query(
      `INSERT INTO group_orders (title, pincode, building_name, coordinator_id, min_amount, closes_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [title, pincode, building_name || null, req.user.id, min_amount || 10000, closes_at || null]
    )
    res.json({ success: true, group: result.rows[0] })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/group-buy/:id/join — join with your items
exports.joinGroupOrder = async (req, res) => {
  const client = await pool.connect()
  try {
    const { id } = req.params
    const { items, amount } = req.body   // items = [{product_id, quantity, price}], amount = total
    if (!items || !amount) return res.status(400).json({ message: "items and amount required" })

    await client.query("BEGIN")

    const g = await client.query(`SELECT * FROM group_orders WHERE id=$1 FOR UPDATE`, [id])
    if (g.rows.length === 0) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Group not found" }) }
    if (g.rows[0].status !== 'open') { await client.query("ROLLBACK"); return res.status(400).json({ message: "Group order is closed" }) }

    // Upsert member contribution
    await client.query(
      `INSERT INTO group_order_members (group_order_id, user_id, items, amount)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (group_order_id, user_id)
       DO UPDATE SET items = EXCLUDED.items, amount = EXCLUDED.amount`,
      [id, req.user.id, JSON.stringify(items), amount]
    )

    // Recalculate group total
    const sum = await client.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM group_order_members WHERE group_order_id=$1`, [id])
    const total = Number(sum.rows[0].total)

    // Lock wholesale price if minimum reached
    let status = g.rows[0].status
    if (total >= Number(g.rows[0].min_amount)) status = 'locked'

    await client.query(
      `UPDATE group_orders SET current_amount=$1, status=$2 WHERE id=$3`,
      [total, status, id])

    await client.query("COMMIT")
    res.json({
      success: true,
      group_total: total,
      min_amount: Number(g.rows[0].min_amount),
      unlocked: status === 'locked',
      message: status === 'locked'
        ? "🎉 Wholesale price unlocked for everyone!"
        : `₹${(Number(g.rows[0].min_amount) - total).toFixed(0)} more to unlock wholesale price`
    })
  } catch (e) {
    await client.query("ROLLBACK")
    res.status(500).json({ message: e.message })
  } finally { client.release() }
}
