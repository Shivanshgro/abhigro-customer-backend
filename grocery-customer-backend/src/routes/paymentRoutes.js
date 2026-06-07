const express = require("express")
const router = express.Router()
const auth = require("../middleware/auth")
const paymentInit = require("../controllers/payment/paymentInit")
const paymentVerify = require("../controllers/payment/paymentVerify")

router.post("/init", auth, paymentInit)
router.post("/verify", auth, paymentVerify)

module.exports = router
