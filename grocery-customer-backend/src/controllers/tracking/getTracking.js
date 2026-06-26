const pool = require("../../config/db")
const { distanceKm, etaMinutes } = require("../../utils/distance")

// GET /api/orders/:id/tracking  (customer must own the order)
const getTracking = async (req, res) => {
  try {
    const userId = req.user.id
    const { id } = req.params

    const q = await pool.query(
      `SELECT o.id, o.status, o.user_id,
              o.customer_latitude, o.customer_longitude,
              o.vendor_latitude, o.vendor_longitude,
              o.estimated_delivery_time, o.assigned_shop_id, o.delivery_boy_id,
              s.latitude AS shop_lat, s.longitude AS shop_lng, s.shop_name,
              u.name AS partner_name, u.phone AS partner_phone,
              a.latitude AS addr_lat, a.longitude AS addr_lng
       FROM orders o
       LEFT JOIN shops s     ON s.id = o.assigned_shop_id
       LEFT JOIN users u     ON u.id = o.delivery_boy_id
       LEFT JOIN addresses a ON a.id = o.address_id
       WHERE o.id = $1`,
      [id]
    )
    if (q.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const r = q.rows[0]
    if (String(r.user_id) !== String(userId)) return res.status(403).json({ message: "Not your order" })

    let partnerLoc = null
    const loc = await pool.query(
      `SELECT latitude, longitude, updated_at FROM delivery_partner_locations WHERE order_id=$1`, [id]
    )
    if (loc.rows.length > 0) {
      partnerLoc = {
        latitude: Number(loc.rows[0].latitude),
        longitude: Number(loc.rows[0].longitude),
        updated_at: loc.rows[0].updated_at,
      }
    }

    const vLat = r.vendor_latitude ?? r.shop_lat
    const vLng = r.vendor_longitude ?? r.shop_lng
    const cLat = r.customer_latitude ?? r.addr_lat
    const cLng = r.customer_longitude ?? r.addr_lng

    let eta = r.estimated_delivery_time || null
    if (partnerLoc && cLat != null) {
      const d = distanceKm(partnerLoc.latitude, partnerLoc.longitude, Number(cLat), Number(cLng))
      const e = etaMinutes(d)
      if (e) eta = e.mid
    }

    res.json({
      order_id: r.id,
      order_status: r.status,
      shop_name: r.shop_name || null,
      vendor_location:   vLat != null ? { latitude: Number(vLat), longitude: Number(vLng) } : null,
      customer_location: cLat != null ? { latitude: Number(cLat), longitude: Number(cLng) } : null,
      delivery_partner_location: partnerLoc,
      delivery_partner_name:  r.partner_name || null,
      delivery_partner_phone: r.partner_phone || null,
      eta_minutes: eta,
    })
  } catch (e) {
    console.log("getTracking error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = getTracking
