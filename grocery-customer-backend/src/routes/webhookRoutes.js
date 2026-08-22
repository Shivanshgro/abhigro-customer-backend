const express = require("express")
const router = express.Router()
const razorpayWebhook = require("../controllers/webhook/razorpayWebhook")

// NOTE: raw body is applied at mount time in server.js
router.post("/razorpay", razorpayWebhook)

module.exports = router
