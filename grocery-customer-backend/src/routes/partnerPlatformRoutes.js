// Partner platform routes — earnings, incentives, rate cards, status.
// Mounted at /api/partner. Does NOT overlap /api/delivery (the frozen flow)
// or /api/register (existing partner signup).
const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const e = require("../controllers/partner/earningsController")

// Earnings
router.get("/earnings/summary",        auth, e.summary)
router.get("/earnings/daily",          auth, e.daily)
router.get("/earnings/orders",         auth, e.orderWise)
router.get("/earnings/order/:orderId", auth, e.breakdown)

// Money config + progress
router.get("/payouts",     auth, e.payouts)
router.get("/incentives",  auth, e.incentives)
router.get("/rate-cards",  auth, e.rateCards)

// Status
router.post("/online", auth, e.setOnline)

module.exports = router
