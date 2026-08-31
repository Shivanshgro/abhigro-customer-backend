const pool = require("../config/db")

/* ═══════════════════════════════════════════════════════════════════════
   Merchant settlements — the calculation.

   Rules, stated once so the code and the vendor agreement can agree:

   1. Only DELIVERED orders settle. An order that was packed but never
      delivered has earned nobody anything.
   2. Commission is on goods value, NOT the delivery fee. The rider is paid
      separately from the delivery fee; charging the shop commission on it
      would be taking the same money twice.
   3. An order settles once, ever. merchant_payout_orders is the ledger,
      and a UNIQUE index enforces it even if the job runs twice.
   4. The commission rate is stored on the payout row. If you raise the rate
      next quarter, last quarter's statement still shows what was actually
      charged.
   ═══════════════════════════════════════════════════════════════════════ */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

async function setting(key, fallback) {
  try {
    const r = await pool.query(`SELECT value FROM app_settings WHERE key=$1`, [key])
    const v = Number(r.rows[0]?.value)
    return Number.isFinite(v) ? v : fallback
  } catch (e) { return fallback }
}

const commissionFor = (type) =>
  setting(type === "pharmacy" ? "pharmacy_commission_pct" : "vendor_commission_pct",
          type === "pharmacy" ? 8 : 10)

/* Monday-to-Sunday week containing `ref`, or the previous one. */
function weekOf(ref = new Date(), previous = false) {
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay()                       // 0 = Sunday
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((dow + 6) % 7))
  if (previous) monday.setDate(monday.getDate() - 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: iso(monday), end: iso(sunday) }
}
const iso = (d) => d.toISOString().slice(0, 10)

/* ── which orders belong to a merchant in a period ─────────────────────
   Grocery and medicine live in different tables with different column
   names, so each gets its own query rather than a clever union that would
   break the first time either schema changes.                            */

async function groceryOrders(shopId, start, end) {
  const r = await pool.query(
    `SELECT o.id,
            COALESCE(o.total_amount, 0)  AS total,
            COALESCE(o.delivery_fee, 0)  AS delivery_fee,
            o.delivered_at
     FROM orders o
     WHERE o.assigned_shop_id = $1
       AND o.status = 'Completed'
       AND COALESCE(o.delivered_at, o.created_at)::date BETWEEN $2 AND $3
       AND NOT EXISTS (
         SELECT 1 FROM merchant_payout_orders m
         WHERE m.order_id = o.id AND m.order_type = 'grocery')
     ORDER BY o.id`,
    [shopId, start, end])
  return r.rows.map(o => {
    // Commission is on goods, so strip the delivery fee out of the total.
    const goods = round2(Number(o.total) - Number(o.delivery_fee))
    return { id: o.id, gross: goods, commission: null, net: null, pct: null }
  })
}

/* medicine_orders already carries a per-order settlement:
     total_medicine_amount        goods only, no delivery or platform fee
     pharmacy_commission_percent  the rate agreed on that order
     pharmacy_commission_amount
     pharmacy_settlement_amount   what the pharmacy is owed
   Those are used as the source of truth. Recomputing them here would let
   the settlement disagree with the invoice the pharmacy already issued.
   The percentage falls back to app_settings only when the order carries
   none, which happens on rows created before commission was recorded.

   There is no delivered_at on medicine_orders, so updated_at is used —
   it is set when the status last changed, which for a delivered order is
   the delivery.                                                          */
async function medicineOrders(pharmacyId, start, end, fallbackPct) {
  const r = await pool.query(
    `SELECT o.id,
            COALESCE(o.total_medicine_amount, o.total_amount - COALESCE(o.delivery_fee,0)
                     - COALESCE(o.platform_fee,0), 0)   AS goods,
            COALESCE(o.pharmacy_commission_percent, 0)  AS pct,
            COALESCE(o.pharmacy_commission_amount, 0)   AS commission,
            COALESCE(o.pharmacy_settlement_amount, 0)   AS settlement
     FROM medicine_orders o
     WHERE o.pharmacy_id = $1
       AND o.order_status = 'delivered'
       AND COALESCE(o.updated_at, o.created_at)::date BETWEEN $2 AND $3
       AND NOT EXISTS (
         SELECT 1 FROM merchant_payout_orders m
         WHERE m.order_id = o.id AND m.order_type = 'medicine')
     ORDER BY o.id`,
    [pharmacyId, start, end])

  return r.rows.map(o => {
    const goods = round2(o.goods)
    const pct = Number(o.pct) > 0 ? Number(o.pct) : fallbackPct
    const commission = Number(o.commission) > 0 ? round2(o.commission) : round2(goods * pct / 100)
    return {
      id: o.id,
      gross: goods,
      commission,
      net: Number(o.settlement) > 0 ? round2(o.settlement) : round2(goods - commission),
      pct,
    }
  })
}

/* ── generate one settlement ───────────────────────────────────────────
   Returns the payout row, or null when there is nothing to settle.       */

async function generatePayout({ merchantType, merchantId, start, end }) {
  const client = await pool.connect()
  try {
    const pct = await commissionFor(merchantType)
    const orderType = merchantType === "pharmacy" ? "medicine" : "grocery"

    const orders = merchantType === "pharmacy"
      ? await medicineOrders(merchantId, start, end, pct)
      : await groceryOrders(merchantId, start, end)

    if (orders.length === 0) return null

    // Use the order's own commission where it has one; otherwise apply the
    // current rate. Mixing the two is correct - a rate change should not
    // rewrite what was already agreed on an earlier order.
    const priced = orders.map(o => {
      const c = o.commission != null ? o.commission : round2(o.gross * pct / 100)
      return { ...o, commission: c, net: o.net != null ? o.net : round2(o.gross - c) }
    })

    const gross = round2(priced.reduce((a, o) => a + o.gross, 0))
    const commission = round2(priced.reduce((a, o) => a + o.commission, 0))
    const net = round2(priced.reduce((a, o) => a + o.net, 0))

    await client.query("BEGIN")

    const p = await client.query(
      `INSERT INTO merchant_payouts
         (merchant_type, merchant_id, period_start, period_end, orders_count,
          gross_amount, commission_pct, commission, net_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
       ON CONFLICT (merchant_type, merchant_id, period_start, period_end)
       DO UPDATE SET
         orders_count = merchant_payouts.orders_count + EXCLUDED.orders_count,
         gross_amount = merchant_payouts.gross_amount + EXCLUDED.gross_amount,
         commission   = merchant_payouts.commission   + EXCLUDED.commission,
         net_amount   = merchant_payouts.net_amount   + EXCLUDED.net_amount
       RETURNING *`,
      [merchantType, merchantId, start, end, orders.length, gross, pct, commission, net])

    const payout = p.rows[0]

    for (const o of priced) {
      await client.query(
        `INSERT INTO merchant_payout_orders
           (payout_id, order_id, order_type, gross, commission, net)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (payout_id, order_id, order_type) DO NOTHING`,
        [payout.id, o.id, orderType, o.gross, o.commission, o.net])
    }

    await client.query("COMMIT")
    return payout
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    console.log("generatePayout error:", e.message)
    return null
  } finally {
    client.release()
  }
}

/* ── run every merchant for a period ───────────────────────────────── */

async function generateAll({ start, end } = {}) {
  const period = (start && end) ? { start, end } : weekOf(new Date(), true)
  const out = { shops: 0, pharmacies: 0, total: 0, period }

  try {
    const shops = await pool.query(`SELECT id FROM shops WHERE is_active = true`)
    for (const s of shops.rows) {
      const p = await generatePayout({
        merchantType: "shop", merchantId: s.id, start: period.start, end: period.end })
      if (p) { out.shops++; out.total += Number(p.net_amount) }
    }
  } catch (e) { console.log("payout shops:", e.message) }

  try {
    const ph = await pool.query(`SELECT id FROM pharmacies WHERE is_active = true`)
    for (const s of ph.rows) {
      const p = await generatePayout({
        merchantType: "pharmacy", merchantId: s.id, start: period.start, end: period.end })
      if (p) { out.pharmacies++; out.total += Number(p.net_amount) }
    }
  } catch (e) { console.log("payout pharmacies:", e.message) }

  out.total = round2(out.total)
  return out
}

/* ── what a merchant is owed right now, before the period closes ────────
   Vendors ask this constantly. Answering it from live orders rather than
   from a settled row is the difference between a panel they trust and one
   they phone you about.                                                   */

async function currentPeriod({ merchantType, merchantId }) {
  const { start, end } = weekOf(new Date(), false)
  const pct = await commissionFor(merchantType)
  const orders = merchantType === "pharmacy"
    ? await medicineOrders(merchantId, start, end, pct)
    : await groceryOrders(merchantId, start, end)

  const gross = round2(orders.reduce((a, o) => a + o.gross, 0))
  const commission = round2(orders.reduce(
    (a, o) => a + (o.commission != null ? o.commission : o.gross * pct / 100), 0))

  return {
    period_start: start, period_end: end,
    orders_count: orders.length,
    gross_amount: gross,
    commission_pct: pct,
    commission,
    net_amount: round2(gross - commission),
    settled: false,
  }
}

module.exports = {
  generatePayout, generateAll, currentPeriod, weekOf, commissionFor,
}
