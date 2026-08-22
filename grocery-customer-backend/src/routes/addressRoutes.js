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
