const express = require("express")
const router = express.Router()
const getSlots = require("../controllers/delivery/getSlots")

router.get("/", getSlots)       // /api/delivery-slots (mounted as /api/delivery-slots)
router.get("/slots", getSlots)  // /api/delivery/slots (old path, keep for compat)

module.exports = router
