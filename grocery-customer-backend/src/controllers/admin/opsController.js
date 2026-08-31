const pool = require("../../config/db")

/* ═══════════════════════════════════════════════════════════════════════
   Command Center — read-only operational aggregation.

   Every block runs in its own try/catch and returns a safe default. A
   console that goes blank because one table is missing is worse than one
   that shows four panels and an honest gap in the fifth — this screen is
   what someone looks at when things are already going wrong.

   Nothing here writes, except the onboarding approve/reject at the bottom.
   ═══════════════════════════════════════════════════════════════════════ */

const n = (v) => Number(v || 0)
const r2 = (v) => Math.round(n(v) * 100) / 100

/* A delivery is late past this. Kept here so the console and any future
   SLA report cannot disagree. */
const SLA_MINUTES = 40

async function safe(fn, fallback) {
  try { return await fn() } catch (e) { console.log("ops:", e.message); return fallback }
}

/* ── GET /api/admin/ops/live ────────────────────────────────────────── */
exports.getLive = async (req, res) => {
  try {
    const out = {}

    // ── headline numbers ──
    out.today = await safe(async () => {
      const q = await pool.query(
        `SELECT
           COUNT(*)::int                                             AS orders,
           COUNT(*) FILTER (WHERE status='Completed')::int           AS delivered,
           COUNT(*) FILTER (WHERE status ILIKE '%cancel%')::int      AS cancelled,
           COALESCE(SUM(total_amount) FILTER (WHERE status='Completed'),0) AS gmv,
           COALESCE(AVG(EXTRACT(EPOCH FROM (delivered_at - created_at))/60)
                    FILTER (WHERE status='Completed' AND delivered_at IS NOT NULL),0) AS avg_min
         FROM orders WHERE created_at::date = CURRENT_DATE`)
      const t = q.rows[0]
      return {
        orders: t.orders, delivered: t.delivered, cancelled: t.cancelled,
        gmv: r2(t.gmv),
        avg_delivery_minutes: Math.round(n(t.avg_min)),
        aov: t.delivered ? Math.round(n(t.gmv) / t.delivered) : 0,
      }
    }, { orders: 0, delivered: 0, cancelled: 0, gmv: 0, avg_delivery_minutes: 0, aov: 0 })

    // Yesterday, so today's number means something.
    out.yesterday = await safe(async () => {
      const q = await pool.query(
        `SELECT COUNT(*)::int AS orders,
                COALESCE(SUM(total_amount) FILTER (WHERE status='Completed'),0) AS gmv
         FROM orders WHERE created_at::date = CURRENT_DATE - 1`)
      return { orders: q.rows[0].orders, gmv: r2(q.rows[0].gmv) }
    }, { orders: 0, gmv: 0 })

    // ── riders ──
    out.riders = await safe(async () => {
      const q = await pool.query(
        `SELECT
           COUNT(*)::int                                    AS approved,
           COUNT(*) FILTER (WHERE is_online = true)::int     AS online
         FROM delivery_partners WHERE is_approved = true`)
      const busy = await pool.query(
        `SELECT COUNT(DISTINCT delivery_boy_id)::int AS c
         FROM orders WHERE status = 'Out For Delivery' AND delivery_boy_id IS NOT NULL`)
      return {
        approved: q.rows[0].approved,
        online: q.rows[0].online,
        on_delivery: busy.rows[0].c,
        idle: Math.max(0, q.rows[0].online - busy.rows[0].c),
      }
    }, { approved: 0, online: 0, on_delivery: 0, idle: 0 })

    // ── vendors ──
    out.vendors = await safe(async () => {
      const q = await pool.query(
        `SELECT COUNT(*)::int AS active,
                COUNT(*) FILTER (WHERE is_online = true)::int AS online
         FROM shops WHERE is_active = true`)
      return q.rows[0]
    }, { active: 0, online: 0 })

    // ── the funnel: where orders stop ──
    out.funnel = await safe(async () => {
      const q = await pool.query(
        `SELECT
           COUNT(*)::int                                                AS placed,
           COUNT(*) FILTER (WHERE assigned_shop_id IS NOT NULL)::int     AS assigned,
           COUNT(*) FILTER (WHERE status IN ('Packed','Out For Delivery','Completed'))::int AS packed,
           COUNT(*) FILTER (WHERE status IN ('Out For Delivery','Completed'))::int          AS picked,
           COUNT(*) FILTER (WHERE status = 'Completed')::int             AS delivered
         FROM orders WHERE created_at::date = CURRENT_DATE`)
      return q.rows[0]
    }, { placed: 0, assigned: 0, packed: 0, picked: 0, delivered: 0 })

    // ── live stream: the last things that happened ──
    out.stream = await safe(async () => {
      const q = await pool.query(
        `SELECT o.id, o.status, o.total_amount, o.created_at, o.delivered_at,
                o.picked_up_at, o.pincode, s.shop_name, u.name AS rider,
                COALESCE(o.delivered_at, o.picked_up_at, o.created_at) AS at
         FROM orders o
         LEFT JOIN shops s ON s.id = o.assigned_shop_id
         LEFT JOIN users u ON u.id = o.delivery_boy_id
         WHERE o.created_at > NOW() - INTERVAL '6 hours'
         ORDER BY at DESC LIMIT 25`)
      return q.rows.map(o => ({
        order_id: o.id,
        status: o.status,
        amount: r2(o.total_amount),
        shop: o.shop_name || null,
        rider: o.rider || null,
        pincode: o.pincode || null,
        at: o.at,
      }))
    }, [])

    // ── zones ──
    out.zones = await safe(async () => {
      const q = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(a.city), ''), o.pincode, 'Unknown') AS zone,
                COUNT(*)::int                                   AS orders,
                COUNT(*) FILTER (WHERE o.status='Completed')::int AS delivered,
                COALESCE(AVG(EXTRACT(EPOCH FROM (o.delivered_at - o.created_at))/60)
                         FILTER (WHERE o.status='Completed'),0)  AS avg_min
         FROM orders o
         LEFT JOIN addresses a ON a.id = o.address_id
         WHERE o.created_at::date = CURRENT_DATE
         GROUP BY 1 ORDER BY orders DESC LIMIT 10`)
      return q.rows.map(z => ({
        zone: z.zone, orders: z.orders, delivered: z.delivered,
        avg_delivery_minutes: Math.round(n(z.avg_min)),
      }))
    }, [])

    // ── the last 14 days, for the sparklines ──
    out.trend = await safe(async () => {
      const q = await pool.query(
        `SELECT d::date AS day,
                COALESCE(COUNT(o.id),0)::int AS orders,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.status='Completed'),0) AS gmv
         FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, '1 day') d
         LEFT JOIN orders o ON o.created_at::date = d::date
         GROUP BY d ORDER BY d`)
      return q.rows.map(x => ({ day: x.day, orders: x.orders, gmv: r2(x.gmv) }))
    }, [])

    // ── medicine, if the vertical is live ──
    out.medicine = await safe(async () => {
      const q = await pool.query(
        `SELECT COUNT(*)::int AS orders,
                COUNT(*) FILTER (WHERE order_status IN
                  ('prescription_uploaded','pending'))::int AS awaiting_verify,
                COALESCE(SUM(total_amount) FILTER (WHERE order_status='delivered'),0) AS gmv
         FROM medicine_orders WHERE created_at::date = CURRENT_DATE`)
      return q.rows[0]
    }, null)

    res.json({ success: true, generated_at: new Date(), sla_minutes: SLA_MINUTES, ...out })
  } catch (e) {
    console.log("getLive error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

/* ── GET /api/admin/ops/incidents ────────────────────────────────────
   Things a human needs to act on, newest first. Each carries enough to
   act without opening another screen.                                   */
exports.getIncidents = async (req, res) => {
  const items = []

  // Late deliveries still in flight.
  await safe(async () => {
    const q = await pool.query(
      `SELECT o.id, o.pincode, o.total_amount, o.created_at, u.name AS rider, u.phone,
              ROUND(EXTRACT(EPOCH FROM (NOW() - o.created_at))/60)::int AS mins
       FROM orders o
       LEFT JOIN users u ON u.id = o.delivery_boy_id
       WHERE o.status NOT IN ('Completed','Cancelled')
         AND o.created_at < NOW() - ($1 || ' minutes')::interval
       ORDER BY o.created_at LIMIT 20`, [String(SLA_MINUTES)])
    q.rows.forEach(o => items.push({
      severity: o.mins > SLA_MINUTES * 2 ? "high" : "medium",
      type: "SLA breach",
      detail: `#${o.id} · ${o.mins} min · ${o.pincode || ""}`,
      order_id: o.id, rider: o.rider, phone: o.phone, at: o.created_at,
    }))
  }, null)

  // Orders nobody has picked up.
  await safe(async () => {
    const q = await pool.query(
      `SELECT id, pincode, created_at,
              ROUND(EXTRACT(EPOCH FROM (NOW() - created_at))/60)::int AS mins
       FROM orders
       WHERE status = 'Packed' AND delivery_boy_id IS NULL
         AND created_at < NOW() - INTERVAL '15 minutes'
       ORDER BY created_at LIMIT 10`)
    q.rows.forEach(o => items.push({
      severity: "high", type: "No rider assigned",
      detail: `#${o.id} · packed ${o.mins} min ago · ${o.pincode || ""}`,
      order_id: o.id, at: o.created_at,
    }))
  }, null)

  // Shops that went offline with work in hand.
  await safe(async () => {
    const q = await pool.query(
      `SELECT s.id, s.shop_name, COUNT(o.id)::int AS pending
       FROM shops s
       JOIN orders o ON o.assigned_shop_id = s.id
        AND o.status NOT IN ('Completed','Cancelled','Out For Delivery')
       WHERE s.is_online = false
       GROUP BY s.id, s.shop_name`)
    q.rows.forEach(s => items.push({
      severity: "medium", type: "Vendor offline",
      detail: `${s.shop_name} · ${s.pending} orders waiting`,
      shop_id: s.id, at: new Date(),
    }))
  }, null)

  // Payments that never completed.
  await safe(async () => {
    const q = await pool.query(
      `SELECT id, total_amount, created_at
       FROM orders
       WHERE payment_status IN ('Pending','Failed')
         AND payment_method NOT ILIKE '%cod%'
         AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC LIMIT 10`)
    q.rows.forEach(o => items.push({
      severity: "medium", type: "Payment not completed",
      detail: `#${o.id} · ₹${r2(o.total_amount)}`,
      order_id: o.id, at: o.created_at,
    }))
  }, null)

  // Prescriptions waiting too long.
  await safe(async () => {
    const q = await pool.query(
      `SELECT id, created_at,
              ROUND(EXTRACT(EPOCH FROM (NOW() - created_at))/60)::int AS mins
       FROM medicine_orders
       WHERE order_status IN ('prescription_uploaded','pending')
         AND created_at < NOW() - INTERVAL '30 minutes'
       ORDER BY created_at LIMIT 10`)
    q.rows.forEach(o => items.push({
      severity: "high", type: "Prescription unverified",
      detail: `#${o.id} · waiting ${o.mins} min`,
      order_id: o.id, at: o.created_at,
    }))
  }, null)

  const rank = { high: 0, medium: 1, low: 2 }
  items.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (new Date(b.at) - new Date(a.at)))

  res.json({
    success: true,
    counts: {
      high: items.filter(i => i.severity === "high").length,
      medium: items.filter(i => i.severity === "medium").length,
      low: items.filter(i => i.severity === "low").length,
    },
    incidents: items.slice(0, 40),
  })
}

/* ── GET /api/admin/ops/queue ──────────────────────────────────────── */
exports.getQueue = async (req, res) => {
  const out = { riders: [], vendors: [], pharmacies: [] }

  out.riders = await safe(async () => {
    const q = await pool.query(
      `SELECT dp.user_id, u.name, u.phone, dp.vehicle_type, dp.vehicle_number,
              dp.created_at
       FROM delivery_partners dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.is_approved = false
       ORDER BY dp.created_at DESC LIMIT 30`)
    return q.rows
  }, [])

  out.vendors = await safe(async () => {
    const q = await pool.query(
      `SELECT id, shop_name, owner_name, phone, address, pincode, created_at
       FROM shops WHERE is_active = false ORDER BY created_at DESC LIMIT 30`)
    return q.rows
  }, [])

  out.pharmacies = await safe(async () => {
    const q = await pool.query(
      `SELECT id, pharmacy_name, owner_name, phone, pincode,
              drug_license_number, pharmacist_registration_number, created_at
       FROM pharmacies WHERE is_active = false ORDER BY created_at DESC LIMIT 30`)
    return q.rows
  }, [])

  res.json({
    success: true, ...out,
    total: out.riders.length + out.vendors.length + out.pharmacies.length,
  })
}

/* ── GET /api/admin/ops/finance ─────────────────────────────────────── */
exports.getFinance = async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7))
  const out = { days }

  out.grocery = await safe(async () => {
    const q = await pool.query(
      `SELECT COUNT(*)::int AS orders,
              COALESCE(SUM(total_amount),0) AS gmv,
              COALESCE(SUM(delivery_fee),0) AS delivery
       FROM orders
       WHERE status = 'Completed'
         AND created_at >= NOW() - ($1 || ' days')::interval`, [String(days)])
    const t = q.rows[0]
    return { orders: t.orders, gmv: r2(t.gmv), delivery: r2(t.delivery) }
  }, { orders: 0, gmv: 0, delivery: 0 })

  out.medicine = await safe(async () => {
    const q = await pool.query(
      `SELECT COUNT(*)::int AS orders,
              COALESCE(SUM(total_amount),0) AS gmv,
              COALESCE(SUM(pharmacy_commission_amount),0) AS commission
       FROM medicine_orders
       WHERE order_status = 'delivered'
         AND created_at >= NOW() - ($1 || ' days')::interval`, [String(days)])
    const t = q.rows[0]
    return { orders: t.orders, gmv: r2(t.gmv), commission: r2(t.commission) }
  }, { orders: 0, gmv: 0, commission: 0 })

  // What is owed and what has gone out.
  out.settlements = await safe(async () => {
    const q = await pool.query(
      `SELECT merchant_type,
              COUNT(*)::int AS payouts,
              COALESCE(SUM(net_amount) FILTER (WHERE status <> 'paid'),0) AS unpaid,
              COALESCE(SUM(net_amount) FILTER (WHERE status = 'paid'),0)  AS paid,
              COALESCE(SUM(commission),0) AS commission
       FROM merchant_payouts GROUP BY merchant_type`)
    return q.rows.map(x => ({
      merchant_type: x.merchant_type, payouts: x.payouts,
      unpaid: r2(x.unpaid), paid: r2(x.paid), commission: r2(x.commission),
    }))
  }, [])

  out.rider_earnings = await safe(async () => {
    const q = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS jobs
       FROM partner_earnings
       WHERE created_at >= NOW() - ($1 || ' days')::interval`, [String(days)])
    return { total: r2(q.rows[0].total), jobs: q.rows[0].jobs }
  }, { total: 0, jobs: 0 })

  const commissionPct = await safe(async () => {
    const s = await pool.query(`SELECT value FROM app_settings WHERE key='vendor_commission_pct'`)
    return Number(s.rows[0]?.value) || 10
  }, 10)

  const groceryGoods = r2(out.grocery.gmv - out.grocery.delivery)
  out.summary = {
    gmv: r2(out.grocery.gmv + out.medicine.gmv),
    orders: out.grocery.orders + out.medicine.orders,
    commission: r2(groceryGoods * commissionPct / 100 + out.medicine.commission),
    commission_pct: commissionPct,
  }

  res.json({ success: true, ...out })
}

/* ── POST /api/admin/ops/approve ────────────────────────────────────
   The one thing this console writes. Kept narrow on purpose: an ops
   screen that can edit anything is an ops screen nobody can audit.     */
exports.approve = async (req, res) => {
  try {
    const { kind, id, approve } = req.body
    const yes = approve !== false
    if (!kind || !id) return res.status(400).json({ message: "kind and id required" })

    if (kind === "rider") {
      await pool.query(`UPDATE delivery_partners SET is_approved=$2 WHERE user_id=$1`, [id, yes])
    } else if (kind === "vendor") {
      await pool.query(`UPDATE shops SET is_active=$2 WHERE id=$1`, [id, yes])
    } else if (kind === "pharmacy") {
      await pool.query(`UPDATE pharmacies SET is_active=$2 WHERE id=$1`, [id, yes])
    } else {
      return res.status(400).json({ message: "Unknown kind" })
    }

    console.log(`[Ops] ${req.user?.id} ${yes ? "approved" : "rejected"} ${kind} ${id}`)
    res.json({ success: true })
  } catch (e) {
    console.log("ops approve:", e.message)
    res.status(500).json({ message: e.message })
  }
}
