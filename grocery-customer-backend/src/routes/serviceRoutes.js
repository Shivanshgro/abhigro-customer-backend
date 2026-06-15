const express = require("express")
const router = express.Router()
const checkPincode = require("../controllers/serviceArea/checkPincode")

// Public — no auth needed (used before login)
router.get("/check/:pincode", checkPincode)

module.exports = router
