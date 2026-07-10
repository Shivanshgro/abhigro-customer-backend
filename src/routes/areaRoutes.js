const express = require("express")
const router = express.Router()
const pool = require("../config/db")

// GET /api/area/list/:pincode — all localities for a pincode (Zepto-style area picker)
router.get("/list/:pincode", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT area_name, city, region, is_active FROM service_areas
       WHERE pincode = $1 AND area_name IS NOT NULL ORDER BY area_name`, [req.params.pincode])
    res.json({ success: true, areas: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
})

// GET /api/area/search?q= — search localities by name ("Bommanahalli" -> matches + pincode)
router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim()
    if (q.length < 2) return res.json({ success: true, areas: [] })
    const r = await pool.query(
      `SELECT pincode, area_name, city, region, is_active FROM service_areas
       WHERE area_name ILIKE $1 ORDER BY is_active DESC, area_name LIMIT 8`, [`%${q}%`])
    res.json({ success: true, areas: r.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
})
module.exports = router
