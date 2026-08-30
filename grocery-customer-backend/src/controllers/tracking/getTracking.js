const pool = require("../../config/db")
const { distanceKm, etaMinutes } = require("../../utils/distance")

/* ═══════════════════════════════════════════════════════════════════════
   GET /api/orders/:id/tracking

   Extends the existing controller. Same route, same auth, same response
   fields as before — nothing that already reads this breaks. What is added:

     stage          one of ten named stages, derived from data we already
                    store. No new order statuses, no schema change.
     leg            'to_store' or 'to_customer' — which journey is live
     eta_minutes    now measured to the LEG's destination, not always the
                    customer. During leg 1 the customer wants to know when
                    the rider reaches the shop.
     distance_m     to that same destination
     partner_stale  true when the last GPS fix is old, so the customer app
                    can say "locating rider" instead of showing a rider
                    frozen in the wrong street.

   "Rider arrived at store" is derived by distance, not a new column: if the
   order is still Packed and the rider is within the geofence radius of the
   shop, they have arrived.
   ═══════════════════════════════════════════════════════════════════════ */

const ARRIVED_STORE_M = 120     // rider is "at the shop" inside this
const ARRIVING_SOON_M = 600     // last leg, tell the customer to come down
const STALE_AFTER_SEC = 90      // older than this and we stop pretending

// The ten stages the customer sees, in order.
const STAGE_LABEL = {
  confirmed:            "Order confirmed",
  preparing:            "Preparing your order",
  packed:               "Packed and ready",
  rider_assigned:       "Delivery partner assigned",
  rider_going_to_store: "Partner heading to the shop",
  rider_at_store:       "Partner at the shop",
  picked_up:            "Order picked up",
  on_the_way:           "On the way to you",
  arriving_soon:        "Arriving soon",
  delivered:            "Delivered",
  cancelled:            "Cancelled",
}

const STAGE_ORDER = [
  "confirmed", "preparing", "packed", "rider_assigned",
  "rider_going_to_store", "rider_at_store", "picked_up",
  "on_the_way", "arriving_soon", "delivered",
]

function deriveStage(r, partner, distToStoreM, distToCustM) {
  const st = String(r.status || "")

  if (/cancel/i.test(st)) return "cancelled"
  if (st === "Completed" || st === "Delivered") return "delivered"

  // ── leg 2: rider has the order ──
  if (st === "Out For Delivery") {
    if (distToCustM != null && distToCustM <= ARRIVING_SOON_M) return "arriving_soon"
    if (partner) return "on_the_way"
    return "picked_up"
  }

  // ── leg 1: order packed, rider on the way to collect ──
  if (st === "Packed") {
    if (!r.delivery_boy_id) return "packed"
    if (partner && distToStoreM != null && distToStoreM <= ARRIVED_STORE_M) return "rider_at_store"
    if (partner) return "rider_going_to_store"
    return "rider_assigned"
  }

  if (st === "Processing") return "preparing"
  return "confirmed"
}

const getTracking = async (req, res) => {
  try {
    const userId = req.user.id
    const { id } = req.params

    const q = await pool.query(
      `SELECT o.id, o.status, o.user_id, o.created_at,
              o.customer_latitude, o.customer_longitude,
              o.vendor_latitude, o.vendor_longitude,
              o.estimated_delivery_time, o.assigned_shop_id, o.delivery_boy_id,
              o.picked_up_at, o.delivered_at, o.arrived_at,
              o.total_amount, o.payment_method, o.payment_status,
              o.delivery_fee, o.discount, o.platform_fee,
              o.delivery_slot, o.delivery_instructions,
              o.packed_photo, o.delivery_photo, o.cash_collected,
              o.cancel_reason, o.cancelled_at,
              a.pincode AS customer_pincode,
              s.latitude AS shop_lat, s.longitude AS shop_lng,
              s.shop_name, s.address AS shop_address, s.phone AS shop_phone,
              u.name AS partner_name, u.phone AS partner_phone,
              dp.vehicle_number, dp.vehicle_type,
              a.latitude AS addr_lat, a.longitude AS addr_lng,
              a.address_line AS customer_address
       FROM orders o
       LEFT JOIN shops s               ON s.id = o.assigned_shop_id
       LEFT JOIN users u               ON u.id = o.delivery_boy_id
       LEFT JOIN delivery_partners dp  ON dp.user_id = o.delivery_boy_id
       LEFT JOIN addresses a           ON a.id = o.address_id
       WHERE o.id = $1`,
      [id]
    )
    if (q.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const r = q.rows[0]
    if (String(r.user_id) !== String(userId)) return res.status(403).json({ message: "Not your order" })

    // ── latest rider fix ──
    let partnerLoc = null, ageSec = null
    const loc = await pool.query(
      `SELECT latitude, longitude, heading, speed, updated_at
       FROM delivery_partner_locations WHERE order_id=$1`, [id])
    if (loc.rows.length > 0) {
      const L = loc.rows[0]
      ageSec = Math.max(0, Math.round((Date.now() - new Date(L.updated_at).getTime()) / 1000))
      partnerLoc = {
        latitude: Number(L.latitude),
        longitude: Number(L.longitude),
        heading: L.heading != null ? Number(L.heading) : null,
        speed: L.speed != null ? Number(L.speed) : null,
        updated_at: L.updated_at,
        age_seconds: ageSec,
      }
    }

    // ── the bill ──
    let items = [], itemTotal = 0
    try {
      const it = await pool.query(
        `SELECT oi.id, oi.product_id, oi.quantity, oi.price,
                p.name, p.image, p.unit
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1
         ORDER BY oi.id`, [id])
      items = it.rows.map(x => ({
        id: x.id,
        product_id: x.product_id,
        name: x.name || "Item",
        image: x.image || null,
        unit: x.unit || null,
        quantity: Number(x.quantity || 0),
        price: Number(x.price || 0),
        line_total: Number(x.price || 0) * Number(x.quantity || 0),
      }))
      itemTotal = items.reduce((a, x) => a + x.line_total, 0)
    } catch (e) {
      console.log("getTracking items:", e.message)
    }

    const vLat = r.vendor_latitude ?? r.shop_lat
    const vLng = r.vendor_longitude ?? r.shop_lng
    const cLat = r.customer_latitude ?? r.addr_lat
    const cLng = r.customer_longitude ?? r.addr_lng

    const metres = (km) => (km == null || isNaN(km)) ? null : Math.round(km * 1000)

    const distToStoreM = (partnerLoc && vLat != null)
      ? metres(distanceKm(partnerLoc.latitude, partnerLoc.longitude, Number(vLat), Number(vLng)))
      : null
    const distToCustM = (partnerLoc && cLat != null)
      ? metres(distanceKm(partnerLoc.latitude, partnerLoc.longitude, Number(cLat), Number(cLng)))
      : null

    const stage = deriveStage(r, partnerLoc, distToStoreM, distToCustM)
    const leg = ["rider_assigned", "rider_going_to_store", "rider_at_store"].includes(stage)
      ? "to_store" : "to_customer"

    // ETA to the destination of the CURRENT leg.
    let etaMin = null
    const legDistM = leg === "to_store" ? distToStoreM : distToCustM
    if (legDistM != null) {
      const e = etaMinutes(legDistM / 1000)
      etaMin = e && e.mid != null ? e.mid : null
    }
    // Before a rider is moving, fall back to whatever the order promised.
    if (etaMin == null) etaMin = r.estimated_delivery_time || null

    res.json({
      // ── unchanged fields, so existing callers keep working ──
      order_id: r.id,
      order_status: r.status,
      shop_name: r.shop_name || null,
      vendor_location:   vLat != null ? { latitude: Number(vLat), longitude: Number(vLng) } : null,
      customer_location: cLat != null ? { latitude: Number(cLat), longitude: Number(cLng) } : null,
      delivery_partner_location: partnerLoc,
      delivery_partner_name:  r.partner_name || null,
      delivery_partner_phone: r.partner_phone || null,
      eta_minutes: etaMin,

      // ── added ──
      stage,
      stage_label: STAGE_LABEL[stage],
      stage_index: STAGE_ORDER.indexOf(stage),
      stage_order: STAGE_ORDER,
      leg,
      distance_m: legDistM,
      distance_to_store_m: distToStoreM,
      distance_to_customer_m: distToCustM,
      partner_stale: partnerLoc ? ageSec > STALE_AFTER_SEC : true,
      partner_vehicle: r.vehicle_number || null,
      partner_vehicle_type: r.vehicle_type || null,
      shop_address: r.shop_address || null,
      shop_phone: r.shop_phone || null,
      customer_address: r.customer_address || null,
      picked_up_at: r.picked_up_at,
      delivered_at: r.delivered_at,
      placed_at: r.created_at,
      total_amount: r.total_amount,
      payment_method: r.payment_method,
      payment_status: r.payment_status,

      // ── full order detail, so /orders/:id needs no second call ──
      items,
      item_total: itemTotal,
      delivery_fee: r.delivery_fee != null ? Number(r.delivery_fee) : 0,
      discount: r.discount != null ? Number(r.discount) : 0,
      platform_fee: r.platform_fee != null ? Number(r.platform_fee) : 0,
      delivery_slot: r.delivery_slot || null,
      delivery_instructions: r.delivery_instructions || null,
      customer_pincode: r.customer_pincode || null,
      packed_photo: r.packed_photo || null,
      delivery_photo: r.delivery_photo || null,
      cash_collected: r.cash_collected ?? null,
      cancel_reason: r.cancel_reason || null,
      cancelled_at: r.cancelled_at || null,
      is_live: !!partnerLoc && !["delivered", "cancelled"].includes(stage),
    })
  } catch (e) {
    console.log("getTracking error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

module.exports = getTracking
module.exports.STAGE_LABEL = STAGE_LABEL
module.exports.STAGE_ORDER = STAGE_ORDER
