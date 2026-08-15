// ────────────────────────────────────────────────────────────────────────────
// unfulfilledAlert.js
//
// An order that no shop picked up currently sits silently. Order 9 waited hours
// with a real customer at the other end and nobody knew. This watches for that.
//
// It does two things every 15 minutes:
//   1. Retries assignment - a shop that came online after the order was placed
//      would otherwise never pick it up, because nothing re-runs assignment.
//   2. Alerts admin about anything still stranded after 20 minutes.
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../config/db")

async function sweep() {
  // ---- 1. retry assignment ----
  try {
    const stuck = await pool.query(
      `SELECT id, pincode FROM orders
       WHERE assignment_status = 'unfulfilled'
         AND status NOT IN ('Cancelled', 'Completed', 'Delivered')
         AND created_at > NOW() - INTERVAL '3 days'
       LIMIT 25`)

    for (const o of stuck.rows) {
      if (!o.pincode) continue
      try {
        // is there now a shop for this pincode that was not there before?
        const shop = await pool.query(
          `SELECT id FROM shops WHERE pincode = $1 LIMIT 1`, [o.pincode])
        if (shop.rows.length === 0) continue

        const upd = await pool.query(
          `UPDATE orders SET assigned_shop_id = $1, assignment_status = 'assigned'
           WHERE id = $2 AND assignment_status = 'unfulfilled'
           RETURNING id`, [shop.rows[0].id, o.id])

        if (upd.rows.length > 0) {
          console.log(`[Unfulfilled] order ${o.id} assigned to shop ${shop.rows[0].id} on retry`)
          try {
            const { emitNewOrder } = require("../socket/emit")
            emitNewOrder({ type: "grocery", id: o.id, shop_id: shop.rows[0].id })
          } catch (e) { /* realtime is a nicety */ }
        }
      } catch (e) { console.log(`[Unfulfilled] retry ${o.id}:`, e.message) }
    }
  } catch (e) { console.log("[Unfulfilled] retry sweep:", e.message) }

  // ---- 2. alert on anything still stranded ----
  try {
    const stranded = await pool.query(
      `SELECT id, pincode, total_amount, created_at FROM orders
       WHERE assignment_status = 'unfulfilled'
         AND status NOT IN ('Cancelled', 'Completed', 'Delivered')
         AND created_at < NOW() - INTERVAL '20 minutes'
         AND created_at > NOW() - INTERVAL '3 days'`)

    if (stranded.rows.length === 0) return

    console.log(`[Unfulfilled] ${stranded.rows.length} order(s) with no shop:`,
      stranded.rows.map(o => `#${o.id} (${o.pincode})`).join(", "))

    try {
      const notify = require("./notify")
      for (const o of stranded.rows) {
        await notify({
          to: "admin",
          type: "order_unfulfilled",
          title: `Order #${o.id} has no shop`,
          message: `Pincode ${o.pincode || "unknown"}, Rs ${o.total_amount}. Placed ${new Date(o.created_at).toLocaleString("en-IN")}. No shop has picked it up.`,
          data: { order_id: o.id, pincode: o.pincode },
        })
      }
    } catch (e) {
      // notify may not be wired; the console line above is the fallback
      console.log("[Unfulfilled] notify unavailable:", e.message)
    }
  } catch (e) { console.log("[Unfulfilled] alert sweep:", e.message) }
}

function start() {
  setInterval(sweep, 15 * 60 * 1000)
  setTimeout(sweep, 60 * 1000)      // once shortly after boot
  console.log("[Unfulfilled] watcher registered")
}

module.exports = { start, sweep }
