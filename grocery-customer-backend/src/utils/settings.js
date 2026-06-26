const pool = require("../config/db")

// Read all delivery-related settings as a typed object (with safe defaults).
async function getDeliverySettings() {
  const defaults = {
    delivery_base_fee: 20, delivery_per_km: 7, delivery_free_above_km: 0,
    delivery_min_fee: 0, delivery_max_fee: 80, delivery_surge: 1,
    free_delivery_above_order: 299,
  }
  try {
    const r = await pool.query(`SELECT key, value FROM app_settings`)
    const out = { ...defaults }
    for (const row of r.rows) {
      const n = Number(row.value)
      if (!isNaN(n)) out[row.key] = n
    }
    return out
  } catch (e) {
    return defaults
  }
}

module.exports = { getDeliverySettings }
