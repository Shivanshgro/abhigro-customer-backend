// Partner platform routes - earnings, slots, referrals, status, history.
// Mounted at /api/partner. Does NOT overlap /api/delivery (frozen flow)
// or /api/register (existing partner signup).
const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const e = require("../controllers/partner/earningsController")
const p = require("../controllers/partner/partnerController")

// Status
router.get("/me",      auth, p.me)
router.post("/online", auth, e.setOnline)

// Earnings
router.get("/earnings/summary",        auth, e.summary)
router.get("/earnings/daily",          auth, e.daily)
router.get("/earnings/orders",         auth, e.orderWise)
router.get("/earnings/order/:orderId", auth, e.breakdown)

// Money config + progress
router.get("/payouts",    auth, e.payouts)
router.get("/incentives", auth, e.incentives)
router.get("/rate-cards", auth, e.rateCards)

// Slots
router.get("/slots",         auth, p.getSlots)
router.post("/slots/book",   auth, p.bookSlot)
router.post("/slots/cancel", auth, p.cancelSlot)

// Referrals
router.get("/referrals",  auth, p.getReferrals)
router.post("/referrals", auth, p.createReferral)

// Completed deliveries with earnings joined
router.get("/history", auth, p.history)

module.exports = router
