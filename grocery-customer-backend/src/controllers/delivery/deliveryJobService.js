// deliveryJobService.js
// Step 4: create delivery jobs from fulfillment orders, with consolidation.
// ADDITIVE: does not touch orders.delivery_boy_id or any live delivery flow.
// Populates delivery_jobs + delivery_job_stops so the logistics model is real
// and provable before it becomes the source of truth.

const pool = require("../../config/db")

// Read admin-configurable settings (seeded in fulfillment_settings)
async function getSetting(key, fallback) {
  try {
    const r = await pool.query(`SELECT value FROM fulfillment_settings WHERE key=$1`, [key])
    return r.rows[0]?.value ?? fallback
  } catch (e) { return fallback }
}

// Straight-line distance (km). Road distance/ETA can replace this later.
function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some(v => v === null || v === undefined)) return null
  const R = 6371, toRad = d => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Order the pickup stops for the shortest overall route:
// nearest-first from the customer's drop point backwards is a decent heuristic
// when we have coordinates; otherwise keep fulfillment order.
function sequenceStops(stops, dropLat, dropLng) {
  const withCoords = stops.filter(s => s.latitude != null && s.longitude != null)
  if (withCoords.length !== stops.length || dropLat == null || dropLng == null) {
    return stops.map((s, i) => ({ ...s, sequence: i + 1 }))
  }
  // Farthest from the customer first, so the last pickup is closest to the drop.
  const sorted = [...stops].sort((a, b) =>
    haversineKm(b.latitude, b.longitude, dropLat, dropLng) -
    haversineKm(a.latitude, a.longitude, dropLat, dropLng)
  )
  return sorted.map((s, i) => ({ ...s, sequence: i + 1 }))
}

// Total route distance: stop1 -> stop2 -> ... -> drop
function routeDistanceKm(orderedStops, dropLat, dropLng) {
  let total = 0, prev = null
  for (const s of orderedStops) {
    if (prev) {
      const d = haversineKm(prev.latitude, prev.longitude, s.latitude, s.longitude)
      if (d == null) return null
      total += d
    }
    prev = s
  }
  if (prev) {
    const d = haversineKm(prev.latitude, prev.longitude, dropLat, dropLng)
    if (d == null) return null
    total += d
  }
  return Math.round(total * 100) / 100
}

/**
 * Create a delivery job for a parent order.
 * Consolidation: all fulfillment orders for the parent become pickup stops on ONE
 * job, up to MAX_PICKUPS_PER_JOB. If there are more than the max, the remainder
 * go onto additional jobs (fallback), so nothing is dropped.
 */
async function createDeliveryJobForParent(parentOrderId, opts = {}) {
  const maxPickups = parseInt(await getSetting("MAX_PICKUPS_PER_JOB", "3"), 10) || 3

  const parent = await pool.query(
    `SELECT id, latitude, longitude FROM parent_orders WHERE id=$1`, [parentOrderId])
  if (parent.rows.length === 0) return { created: false, reason: "parent order not found" }
  const dropLat = parent.rows[0].latitude
  const dropLng = parent.rows[0].longitude

  // Pickup candidates: every fulfillment order for this parent, with its location.
  const fos = await pool.query(
    `SELECT fo.id AS fulfillment_order_id, fo.fulfillment_location_id, fo.status,
            fl.latitude, fl.longitude
     FROM fulfillment_orders fo
     LEFT JOIN fulfillment_locations fl ON fl.id = fo.fulfillment_location_id
     WHERE fo.parent_order_id = $1
     ORDER BY fo.id`, [parentOrderId])
  if (fos.rows.length === 0) return { created: false, reason: "no fulfillment orders" }

  // Don't duplicate a job for the same parent.
  const existing = await pool.query(
    `SELECT id FROM delivery_jobs WHERE parent_order_id=$1 LIMIT 1`, [parentOrderId])
  if (existing.rows.length > 0) {
    return { created: false, reason: "delivery job already exists", delivery_job_id: existing.rows[0].id }
  }

  // Consolidate: chunk stops into jobs of at most maxPickups.
  const chunks = []
  for (let i = 0; i < fos.rows.length; i += maxPickups) {
    chunks.push(fos.rows.slice(i, i + maxPickups))
  }

  const client = await pool.connect()
  const created = []
  try {
    await client.query("BEGIN")
    for (const chunk of chunks) {
      const ordered = sequenceStops(chunk, dropLat, dropLng)
      const distance = routeDistanceKm(ordered, dropLat, dropLng)

      const job = await client.query(
        `INSERT INTO delivery_jobs
           (parent_order_id, vehicle_type, status, drop_latitude, drop_longitude, total_distance_km)
         VALUES ($1,$2,'CREATED',$3,$4,$5)
         RETURNING id`,
        [parentOrderId, opts.vehicleType || "BIKE", dropLat, dropLng, distance]
      )
      const jobId = job.rows[0].id

      for (const s of ordered) {
        await client.query(
          `INSERT INTO delivery_job_stops
             (delivery_job_id, fulfillment_order_id, fulfillment_location_id, sequence)
           VALUES ($1,$2,$3,$4)`,
          [jobId, s.fulfillment_order_id, s.fulfillment_location_id, s.sequence]
        )
      }
      created.push({ delivery_job_id: jobId, stops: ordered.length, distance_km: distance })
    }
    await client.query("COMMIT")
    return { created: true, jobs: created, consolidated: chunks.length === 1 }
  } catch (e) {
    await client.query("ROLLBACK")
    return { created: false, reason: e.message }
  } finally {
    client.release()
  }
}

/**
 * Consolidation readiness check: are all fulfillment orders ready, or has the
 * configured wait window elapsed? Used to decide when to dispatch a partner.
 * Returns { dispatch: bool, reason } — callers decide what to do with it.
 */
async function shouldDispatch(parentOrderId) {
  const waitMin = parseInt(await getSetting("MAX_CONSOLIDATION_WAIT_MIN", "5"), 10) || 5
  const r = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'ready')::int AS ready,
            MIN(created_at) AS first_created
     FROM fulfillment_orders WHERE parent_order_id=$1`, [parentOrderId])
  const row = r.rows[0]
  if (!row || row.total === 0) return { dispatch: false, reason: "no fulfillment orders" }
  if (row.ready === row.total) return { dispatch: true, reason: "all fulfillment orders ready" }
  const waitedMs = Date.now() - new Date(row.first_created).getTime()
  if (waitedMs >= waitMin * 60 * 1000) {
    return { dispatch: true, reason: `wait window of ${waitMin} min elapsed` }
  }
  return { dispatch: false, reason: `waiting for ${row.total - row.ready} of ${row.total} to be ready` }
}

module.exports = { createDeliveryJobForParent, shouldDispatch }
