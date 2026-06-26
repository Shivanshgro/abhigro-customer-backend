const pool = require("../../config/db")

// Check a pharmacy has all requested items in stock
async function pharmacyHasStock(pharmacyId, items) {
  for (const it of items) {
    const r = await pool.query(
      `SELECT stock FROM medicine_products
       WHERE pharmacy_id=$1 AND id=$2 AND is_active=true`,
      [pharmacyId, it.medicine_product_id]
    )
    if (r.rows.length === 0 || Number(r.rows[0].stock) < Number(it.quantity)) return false
  }
  return true
}

// Pick a licensed, active, online pharmacy that has stock for all items.
// 1) same pincode (ordered by online + recently active)
// 2) nearby pincodes (numeric proximity fallback)
// Returns { pharmacyId } or { pharmacyId: null }
async function assignPharmacy(pincode, items) {
  // 1. same pincode
  const samePin = await pool.query(
    `SELECT id FROM pharmacies
     WHERE pincode=$1 AND is_active=true AND is_online=true
       AND (license_expiry_date IS NULL OR license_expiry_date >= CURRENT_DATE)
     ORDER BY updated_at DESC`,
    [pincode]
  )
  for (const ph of samePin.rows) {
    if (await pharmacyHasStock(ph.id, items)) return { pharmacyId: ph.id, basis: "same_pincode" }
  }

  // 2. nearby pincodes — order by absolute numeric distance of pincode
  const nearby = await pool.query(
    `SELECT id, pincode FROM pharmacies
     WHERE is_active=true AND is_online=true
       AND (license_expiry_date IS NULL OR license_expiry_date >= CURRENT_DATE)
       AND pincode IS NOT NULL AND pincode <> $1
     ORDER BY ABS( CAST(NULLIF(regexp_replace(pincode,'\\D','','g'),'') AS INT)
                 - CAST(NULLIF(regexp_replace($1,'\\D','','g'),'') AS INT) ) ASC
     LIMIT 25`,
    [pincode || ""]
  )
  for (const ph of nearby.rows) {
    if (await pharmacyHasStock(ph.id, items)) return { pharmacyId: ph.id, basis: "nearby_pincode" }
  }

  return { pharmacyId: null, basis: "none" }
}

// Decrement stock for assigned pharmacy
async function decrementStock(pharmacyId, items) {
  for (const it of items) {
    await pool.query(
      `UPDATE medicine_products SET stock = GREATEST(stock - $1, 0)
       WHERE pharmacy_id=$2 AND id=$3`,
      [it.quantity, pharmacyId, it.medicine_product_id]
    )
  }
}

module.exports = { assignPharmacy, pharmacyHasStock, decrementStock }
