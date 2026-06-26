const express = require("express")
const router = express.Router()
const p = require("../controllers/partner/partnerOnboardController")

// PUBLIC self-onboarding (pending admin approval)
router.post("/vendor", p.registerVendor)
router.post("/delivery", p.registerDelivery)

module.exports = router