const pool = require("../../config/db")
const { distanceKm, etaMinutes, deliveryFee } = require("../../utils/distance")
const { getDeliverySettings } = require("../../utils/settings")

// GET /api/orders/quote?address_id=..&shop_id=..&order_total=..
// Returns { distance_km, eta, delivery_fee, free_delivery } for the UI.
const getQuote = async (req, res) => {
  try {
    const userId = req.user.id
    const { address_id, shop_id, order_total } = req.query

    // Resolve customer coords (from chosen/default address)
    let cLat = null, cLng = null
    let addr
    if (address_id) addr = await pool.query(`SELECT latitude, longitude FROM addresses WHERE id=$1 AND user_id=$2`, [address_id, userId])
    if (!addr || addr.rows.length === 0) addr = await pool.query(`SELECT latitude, longitude FROM addresses WHERE user_id=$1 ORDER BY id DESC LIMIT 1`, [userId])
    if (addr.rows.length > 0) { cLat = addr.rows[0].latitude; cLng = addr.rows[0].longitude }

    // Resolve shop coords (specific shop, else nearest active in flow — fallback any active)
    let sLat = null, sLng = null
    let shop
    if (shop_id) shop = await pool.query(`SELECT latitude, longitude FROM shops WHERE id=$1`, [shop_id])
    if (!shop || shop.rows.length === 0) shop = await pool.query(`SELECT latitude, longitude FROM shops WHERE is_active=true AND latitude IS NOT NULL ORDER BY id LIMIT 1`)
    if (shop.rows.length > 0) { sLat = shop.rows[0].latitude; sLng = shop.rows[0].longitude }

    const settings = await getDeliverySettings()
    const d = distanceKm(sLat, sLng, cLat, cLng)
    const e = etaMinutes(d)

    const total = Number(order_total || 0)
    const freeDelivery = settings.free_delivery_above_order > 0 && total >= settings.free_delivery_above_order

    const fee = freeDelivery ? 0 : deliveryFee(d, {
      baseFee: settings.delivery_base_fee, perKm: settings.delivery_per_km,
      freeAboveKm: settings.delivery_free_above_km, minFee: settings.delivery_min_fee,
      maxFee: settings.delivery_max_fee, surge: settings.delivery_surge,
    })

    res.json({
      distance_km: d != null ? Math.round(d * 10) / 10 : null,
      eta,
      delivery_fee: fee,
      free_delivery: freeDelivery,
      free_delivery_threshold: settings.free_delivery_above_order,
    })
  } catch (e) {
    console.log("getQuote error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = getQuote
