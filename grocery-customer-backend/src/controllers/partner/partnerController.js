// Partner platform - slots, referrals, status, order history.
//
// SAFETY: read/write only to the partner_* tables added by
// ensurePartnerPlatformSchema. Reads orders/shops/addresses but never writes
// to them. Nothing here touches the delivery flow.
const pool = require("../../config/db")

/* ── STATUS ──────────────────────────────────────────────────────────── */

// GET /api/partner/me - current status, so the toggle survives a reload.
exports.me = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, u.phone,
              COALESCE(dp.is_online,false) AS is_online,
              dp.last_online_at,
              COALESCE(dp.cash_balance,0) AS cash_balance
       FROM users u
       LEFT JOIN delivery_partners dp ON dp.user_id = u.id
       WHERE u.id = $1`, [req.user.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Partner not found" })

    // Cash in hand = COD collected on orders not yet settled.
    let cash_in_hand = 0
    try {
      const c = await pool.query(
        `SELECT COALESCE(SUM(total_amount),0) AS cash
         FROM orders
         WHERE delivery_boy_id = $1
           AND status = 'Completed'
           AND cash_collected = true
           AND settled_at IS NULL`, [req.user.id])
      cash_in_hand = Number(c.rows[0]?.cash || 0)
    } catch (e) { /* settled_at may not exist yet - leave at 0 */ }

    res.json({ success: true, partner: { ...r.rows[0], cash_in_hand } })
  } catch (e) {
    console.log("partner me error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

/* ── SLOTS ───────────────────────────────────────────────────────────── */

function weekRange(which) {
  const now = new Date()
  const day = now.getDay()                    // 0 = Sun
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((day + 6) % 7))
  monday.setHours(0, 0, 0, 0)
  if (which === "next") monday.setDate(monday.getDate() + 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: monday, end: sunday }
}

const iso = (d) => d.toISOString().slice(0, 10)

// GET /api/partner/slots?week=current|next
// Expands weekly templates into dated slots and marks which this partner booked.
exports.getSlots = async (req, res) => {
  try {
    const which = req.query.week === "next" ? "next" : "current"
    const { start, end } = weekRange(which)

    const tpl = await pool.query(
      `SELECT id, label, start_time, end_time, day_of_week, capacity,
              is_peak, is_quick, break_mins
       FROM partner_slot_templates
       WHERE is_active = true
       ORDER BY start_time`)

    const bookings = await pool.query(
      `SELECT template_id, slot_date, status FROM partner_slot_bookings
       WHERE partner_id = $1 AND slot_date BETWEEN $2 AND $3`,
      [req.user.id, iso(start), iso(end)])

    const counts = await pool.query(
      `SELECT template_id, slot_date, COUNT(*)::int AS taken
       FROM partner_slot_bookings
       WHERE slot_date BETWEEN $1 AND $2 AND status = 'booked'
       GROUP BY template_id, slot_date`, [iso(start), iso(end)])

    const bookedKey = new Set(bookings.rows
      .filter(b => b.status === "booked")
      .map(b => `${b.template_id}|${iso(new Date(b.slot_date))}`))
    const takenMap = new Map(counts.rows
      .map(c => [`${c.template_id}|${iso(new Date(c.slot_date))}`, c.taken]))

    const days = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const dateStr = iso(d)
      const slots = tpl.rows
        .filter(t => t.day_of_week == null || Number(t.day_of_week) === d.getDay())
        .map(t => {
          const key = `${t.id}|${dateStr}`
          const taken = takenMap.get(key) || 0
          return {
            template_id: t.id,
            date: dateStr,
            label: t.label || `${String(t.start_time).slice(0, 5)} - ${String(t.end_time).slice(0, 5)}`,
            start_time: t.start_time,
            end_time: t.end_time,
            is_peak: t.is_peak,
            is_quick: t.is_quick,
            break_mins: t.break_mins,
            capacity: t.capacity,
            taken,
            full: taken >= Number(t.capacity || 0),
            booked: bookedKey.has(key),
          }
        })
      days.push({ date: dateStr, slots })
    }

    res.json({ success: true, week: which, start: iso(start), end: iso(end), days })
  } catch (e) {
    console.log("getSlots error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// POST /api/partner/slots/book  { template_id, date }
exports.bookSlot = async (req, res) => {
  try {
    const { template_id, date } = req.body || {}
    if (!template_id || !date) return res.status(400).json({ message: "Slot and date are required" })

    const t = await pool.query(
      `SELECT capacity FROM partner_slot_templates WHERE id=$1 AND is_active=true`, [template_id])
    if (t.rows.length === 0) return res.status(404).json({ message: "Slot not available" })

    const taken = await pool.query(
      `SELECT COUNT(*)::int AS n FROM partner_slot_bookings
       WHERE template_id=$1 AND slot_date=$2 AND status='booked'`, [template_id, date])
    if (Number(taken.rows[0].n) >= Number(t.rows[0].capacity || 0)) {
      return res.status(409).json({ message: "This slot is full" })
    }

    await pool.query(
      `INSERT INTO partner_slot_bookings(partner_id, template_id, slot_date, status)
       VALUES($1,$2,$3,'booked')
       ON CONFLICT (partner_id, template_id, slot_date)
       DO UPDATE SET status='booked', booked_at=NOW()`,
      [req.user.id, template_id, date])

    res.json({ success: true, message: "Slot booked" })
  } catch (e) {
    console.log("bookSlot error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

// POST /api/partner/slots/cancel  { template_id, date }
exports.cancelSlot = async (req, res) => {
  try {
    const { template_id, date } = req.body || {}
    await pool.query(
      `UPDATE partner_slot_bookings SET status='cancelled'
       WHERE partner_id=$1 AND template_id=$2 AND slot_date=$3`,
      [req.user.id, template_id, date])
    res.json({ success: true, message: "Slot cancelled" })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

/* ── REFERRALS ───────────────────────────────────────────────────────── */

exports.getReferrals = async (req, res) => {
  try {
    const list = await pool.query(
      `SELECT id, friend_name, friend_phone, work_city, status, reward_amount, created_at
       FROM partner_referrals WHERE referrer_id=$1 ORDER BY id DESC LIMIT 50`, [req.user.id])

    const paid = await pool.query(
      `SELECT COALESCE(SUM(reward_amount),0) AS earned
       FROM partner_referrals WHERE referrer_id=$1 AND status='paid'`, [req.user.id])

    let reward = 200
    try {
      const s = await pool.query(`SELECT value FROM app_settings WHERE key='partner_referral_reward'`)
      if (s.rows[0]) reward = Number(s.rows[0].value) || reward
    } catch (e) { /* default */ }

    res.json({
      success: true,
      referrals: list.rows,
      earned: Number(paid.rows[0].earned || 0),
      reward_per_referral: reward,
    })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// POST /api/partner/referrals  { friend_name, friend_phone, work_city }
exports.createReferral = async (req, res) => {
  try {
    const b = req.body || {}
    const phone = String(b.friend_phone || "").replace(/\D/g, "")
    if (!b.friend_name || phone.length < 10) {
      return res.status(400).json({ message: "Name and a valid 10-digit phone are required" })
    }

    const dupe = await pool.query(
      `SELECT 1 FROM partner_referrals WHERE friend_phone=$1 LIMIT 1`, [phone])
    if (dupe.rows.length > 0) {
      return res.status(409).json({ message: "This number has already been referred" })
    }

    const existing = await pool.query(`SELECT 1 FROM users WHERE phone=$1 LIMIT 1`, [phone])
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "This number is already registered with AbhiGro" })
    }

    let reward = 200
    try {
      const s = await pool.query(`SELECT value FROM app_settings WHERE key='partner_referral_reward'`)
      if (s.rows[0]) reward = Number(s.rows[0].value) || reward
    } catch (e) { /* default */ }

    const r = await pool.query(
      `INSERT INTO partner_referrals(referrer_id, friend_name, friend_phone, work_city, status, reward_amount)
       VALUES($1,$2,$3,$4,'invited',$5) RETURNING *`,
      [req.user.id, b.friend_name, phone, b.work_city || null, reward])

    res.json({ success: true, referral: r.rows[0], message: "Invite recorded" })
  } catch (e) {
    console.log("createReferral error:", e.message)
    res.status(500).json({ message: e.message })
  }
}

/* ── ORDER HISTORY (reads the real orders table, never writes) ───────── */

// GET /api/partner/history?limit=50
exports.history = async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const q = await pool.query(
      `SELECT o.id, o.total_amount, o.status, o.payment_method, o.delivered_at,
              o.delivered_distance_m,
              s.shop_name,
              a.city AS customer_area, a.pincode,
              pe.total_pay, pe.base_pay, pe.distance_pay, pe.surge_pay,
              pe.incentive_pay, pe.distance_km
       FROM orders o
       LEFT JOIN shops s ON s.id = o.assigned_shop_id
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN partner_earnings pe ON pe.order_id = o.id
       WHERE o.delivery_boy_id = $1 AND o.status = 'Completed'
       ORDER BY o.delivered_at DESC NULLS LAST, o.id DESC
       LIMIT $2`, [req.user.id, limit])
    res.json({ success: true, orders: q.rows })
  } catch (e) {
    console.log("partner history error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
