// ────────────────────────────────────────────────────────────────────────────
// allAvailable.js — one list for riders, across every vertical.
//
// A rider should not have to check two apps. This merges grocery and food into
// a single feed with a `type` field; the UI dispatches the right action from
// that. Nothing is merged underneath — each vertical keeps its own table,
// statuses and state machine, so this is presentation only and low risk.
//
// Mounted under /api/delivery (see deliveryBoyRoutes.js).
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../../config/db")

// GET /api/delivery/all-available
// Unclaimed work, oldest first — the order that has waited longest comes first.
exports.allAvailable = async (req, res) => {
  const out = []

  // ── grocery ───────────────────────────────────────────────────────────────
  try {
    const g = await pool.query(
      `SELECT o.id, o.total_amount, o.status, o.payment_method, o.payment_status,
              o.created_at, o.pincode,
              s.shop_name, s.address AS pickup_address,
              a.address_line, a.city, a.pincode AS drop_pincode,
              u.name AS customer_name, u.phone AS customer_phone
       FROM orders o
       LEFT JOIN shops s     ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN users u     ON u.id = o.user_id
       WHERE o.status = 'Packed' AND o.delivery_boy_id IS NULL
       ORDER BY o.id DESC`)
    for (const r of g.rows) {
      out.push({
        type: "grocery",
        id: r.id,
        from: r.shop_name || "AbhiGro store",
        pickup_address: r.pickup_address || null,
        drop_address: [r.address_line, r.city].filter(Boolean).join(", ") || null,
        customer_name: r.customer_name || null,
        customer_phone: r.customer_phone || null,
        total: Number(r.total_amount || 0),
        status: r.status,
        cod: r.payment_status !== "Paid" && r.payment_status !== "Collected",
        ready: true,                       // 'Packed' already means ready to collect
        placed_at: r.created_at,
      })
    }
  } catch (e) {
    // one vertical failing must not blank the rider's whole screen
    console.log("allAvailable grocery error:", e.message)
  }

  // ── food ──────────────────────────────────────────────────────────────────
  try {
    const f = await pool.query(
      `SELECT o.id, o.total_amount, o.order_status, o.payment_status, o.created_at,
              o.delivery_address, o.delivery_phone, o.items,
              fr.restaurant_name, fr.address AS pickup_address,
              u.name AS customer_name
       FROM food_orders o
       JOIN food_restaurants fr ON fr.id = o.restaurant_id
       LEFT JOIN users u ON u.id = o.customer_id
       WHERE o.order_status IN ('restaurant_accepted','preparing','food_ready')
         AND o.delivery_partner_id IS NULL
       ORDER BY o.id DESC`)
    for (const r of f.rows) {
      out.push({
        type: "food",
        id: r.id,
        from: r.restaurant_name,
        pickup_address: r.pickup_address || null,
        drop_address: r.delivery_address || null,
        customer_name: r.customer_name || null,
        customer_phone: r.delivery_phone || null,
        total: Number(r.total_amount || 0),
        status: r.order_status,
        cod: r.payment_status !== "paid",
        ready: r.order_status === "food_ready",   // false = still cooking
        items: r.items || [],
        placed_at: r.created_at,
      })
    }
  } catch (e) {
    console.log("allAvailable food error:", e.message)
  }

  // oldest first: whoever has waited longest gets picked up first
  out.sort((a, b) => new Date(a.placed_at) - new Date(b.placed_at))
  res.json({ success: true, orders: out })
}

// GET /api/delivery/all-mine
// Everything this rider is currently carrying, both verticals.
exports.allMine = async (req, res) => {
  const out = []
  const me = req.user.id

  try {
    const g = await pool.query(
      `SELECT o.id, o.total_amount, o.status, o.payment_status, o.created_at,
              s.shop_name, s.address AS pickup_address,
              a.address_line, a.city,
              u.name AS customer_name, u.phone AS customer_phone
       FROM orders o
       LEFT JOIN shops s     ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN users u     ON u.id = o.user_id
       WHERE o.delivery_boy_id = $1
         AND o.status IN ('Packed','Out For Delivery')
       ORDER BY o.id DESC`, [me])
    for (const r of g.rows) {
      out.push({
        type: "grocery", id: r.id,
        from: r.shop_name || "AbhiGro store",
        pickup_address: r.pickup_address || null,
        drop_address: [r.address_line, r.city].filter(Boolean).join(", ") || null,
        customer_name: r.customer_name || null,
        customer_phone: r.customer_phone || null,
        total: Number(r.total_amount || 0),
        status: r.status,
        cod: r.payment_status !== "Paid" && r.payment_status !== "Collected",
        placed_at: r.created_at,
      })
    }
  } catch (e) { console.log("allMine grocery error:", e.message) }

  try {
    const f = await pool.query(
      `SELECT o.id, o.total_amount, o.order_status, o.payment_status, o.created_at,
              o.delivery_address, o.delivery_phone, o.items,
              fr.restaurant_name, fr.address AS pickup_address,
              u.name AS customer_name
       FROM food_orders o
       JOIN food_restaurants fr ON fr.id = o.restaurant_id
       LEFT JOIN users u ON u.id = o.customer_id
       WHERE o.delivery_partner_id = $1
         AND o.order_status NOT IN ('delivered','cancelled','refunded')
       ORDER BY o.id DESC`, [me])
    for (const r of f.rows) {
      out.push({
        type: "food", id: r.id,
        from: r.restaurant_name,
        pickup_address: r.pickup_address || null,
        drop_address: r.delivery_address || null,
        customer_name: r.customer_name || null,
        customer_phone: r.delivery_phone || null,
        total: Number(r.total_amount || 0),
        status: r.order_status,
        cod: r.payment_status !== "paid",
        items: r.items || [],
        placed_at: r.created_at,
      })
    }
  } catch (e) { console.log("allMine food error:", e.message) }

  out.sort((a, b) => new Date(a.placed_at) - new Date(b.placed_at))
  res.json({ success: true, orders: out })
}
