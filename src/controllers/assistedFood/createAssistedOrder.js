const pool = require("../../config/db")
const { getDeliverySettings } = require("../../utils/settings")

// POST /api/assisted-food/order
// Customer creates an assisted-food order and pays ONLY platform + delivery fee now.
// Body: shop_name, pickup_location, pickup_lat, pickup_lng, food_item, quantity,
//       special_instructions, estimated_food_amount
const createAssistedOrder = async (req, res) => {
  try {
    const userId = req.user.id
    const {
      shop_name, pickup_location, pickup_lat, pickup_lng,
      food_item, quantity, special_instructions, estimated_food_amount,
    } = req.body
    if (!shop_name || !food_item) return res.status(400).json({ message: "Shop name and food item are required" })

    // fees from app_settings (assisted_* keys, fallback to defaults)
    let platformFee = 15, deliveryFee = 30
    try {
      const r = await pool.query(`SELECT key,value FROM app_settings WHERE key IN ('assisted_platform_fee','assisted_delivery_fee')`)
      for (const row of r.rows) {
        if (row.key === 'assisted_platform_fee') platformFee = Number(row.value) || platformFee
        if (row.key === 'assisted_delivery_fee') deliveryFee = Number(row.value) || deliveryFee
      }
    } catch (e) {}

    const o = await pool.query(
      `INSERT INTO assisted_food_orders
        (user_id, shop_name, pickup_location, pickup_lat, pickup_lng,
         food_item, quantity, special_instructions, estimated_food_amount,
         platform_fee, delivery_fee, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'platform_paid')
       RETURNING *`,
      [userId, shop_name, pickup_location || null, pickup_lat || null, pickup_lng || null,
       food_item, quantity || null, special_instructions || null, estimated_food_amount || 0,
       platformFee, deliveryFee])

    // NOTE: platform+delivery fee payment uses your existing Razorpay flow on the
    // frontend (paymentInit/verify). The order is created as 'platform_paid' assuming
    // the upfront fee is collected at this step. If you want to gate creation behind
    // payment, call paymentInit first and create the order in verify — left simple here.

    res.json({ success: true, order: o.rows[0],
      fees: { platform_fee: platformFee, delivery_fee: deliveryFee, total_now: platformFee + deliveryFee } })
  } catch (e) {
    console.log("createAssistedOrder error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = createAssistedOrder
