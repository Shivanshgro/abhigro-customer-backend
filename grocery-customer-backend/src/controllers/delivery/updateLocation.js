const pool = require("../../config/db")
const { emitOrderUpdate } = require("../../socket/emit")

// POST /api/delivery/location/update  { order_id, latitude, longitude, heading?, speed? }
const updateLocation = async (req, res) => {
  try {
    const userId = req.user.id
    const { order_id, latitude, longitude, heading, speed } = req.body
    if (!order_id || latitude == null || longitude == null) {
      return res.status(400).json({ message: "order_id, latitude, longitude required" })
    }

    const ord = await pool.query(`SELECT id, status, delivery_boy_id FROM orders WHERE id=$1`, [order_id])
    if (ord.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const order = ord.rows[0]

    if (String(order.delivery_boy_id) !== String(userId)) {
      return res.status(403).json({ message: "Not your assigned order" })
    }
    const active = ["Out For Delivery", "Packed"]
    if (!active.includes(order.status)) {
      return res.status(409).json({ message: "Order not in a trackable state" })
    }

    await pool.query(
      `INSERT INTO delivery_partner_locations
         (order_id, delivery_boy_id, latitude, longitude, heading, speed, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (order_id) DO UPDATE SET
         latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
         heading=EXCLUDED.heading, speed=EXCLUDED.speed,
         delivery_boy_id=EXCLUDED.delivery_boy_id, updated_at=NOW()`,
      [order_id, userId, latitude, longitude, heading || null, speed || null]
    )

    // Live push to anyone watching this order room
    emitOrderUpdate(order_id, { type: "location", latitude, longitude })

    res.json({ success: true })
  } catch (e) {
    console.log("updateLocation error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = updateLocation
