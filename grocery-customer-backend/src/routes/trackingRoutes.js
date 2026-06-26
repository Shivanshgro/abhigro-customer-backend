const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const updateLocation = require("../controllers/delivery/updateLocation")

// POST /api/tracking/location/update  (delivery partner GPS, every 60s)
router.post("/location/update", auth, updateLocation)

module.exports = router
