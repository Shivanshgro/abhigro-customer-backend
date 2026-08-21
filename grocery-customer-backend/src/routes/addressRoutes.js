const express = require("express")
const router = express.Router()
const auth = require("../middleware/auth")
const addAddress = require("../controllers/address/addAddress")
const getAddress = require("../controllers/address/getAddress")
const updateAddress = require("../controllers/address/updateAddress")
const pool = require("../config/db")

router.post("/", auth, addAddress)
router.get("/", auth, getAddress)           // was /:user_id — now uses token
router.put("/:id", auth, updateAddress)
router.patch("/:id", auth, updateAddress)   // same handler, both verbs accepted

// Single address (used when Checkout needs to re-read one after editing)
router.get("/:id", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, id AS "_id", full_name AS name, full_name, phone,
              address_line AS address, address_line, city, state, pincode,
              label, latitude, longitude
       FROM addresses WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id])
    if (r.rows.length === 0) return res.status(404).json({ message: "Address not found" })
    res.json(r.rows[0])
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})
router.delete("/:id", auth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM addresses WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    )
    res.json({ success: true, message: "Deleted" })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

module.exports = router
