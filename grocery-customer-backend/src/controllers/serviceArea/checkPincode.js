const pool = require("../../config/db")

// GET /api/service/check/:pincode
// Returns whether AbhiGro delivers to this pincode + which region
const checkPincode = async (req, res) => {
  try {
    const { pincode } = req.params
    if (!pincode || pincode.length !== 6) {
      return res.status(400).json({ serviceable: false, message: "Enter a valid 6-digit pincode" })
    }

    const result = await pool.query(
      `SELECT pincode, area_name, city, region, is_active
       FROM service_areas WHERE pincode = $1`,
      [pincode]
    )

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.json({
        serviceable: false,
        message: "We're not delivering to your area yet. Coming soon! 🚀",
      })
    }

    const area = result.rows[0]
    res.json({
      serviceable: true,
      region:    area.region,
      area_name: area.area_name,
      city:      area.city,
      message:   `Delivering to ${area.area_name}, ${area.city} ✅`,
    })
  } catch (error) {
    res.status(500).json({ serviceable: false, message: error.message })
  }
}

module.exports = checkPincode
