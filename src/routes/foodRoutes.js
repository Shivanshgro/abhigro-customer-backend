const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const browse = require("../controllers/foodCustomer/browse")
const order = require("../controllers/foodCustomer/placeOrder")
const del = require("../controllers/foodCustomer/foodDelivery")

// ── Customer ────────────────────────────────────────────────────────────────
router.get("/restaurants", browse.nearbyRestaurants)
router.get("/restaurants/:id/menu", browse.restaurantMenu)
router.post("/order", auth, order.placeOrder)
router.post("/order/:id/verify", auth, order.verifyPayment)
router.get("/my-orders", auth, order.myOrders)
router.post("/check-offer", auth, order.checkOffer)
router.post("/order/:id/rate", auth, del.rate)

// ── Delivery partner ────────────────────────────────────────────────────────
// The rider chain is: claim → (arrived) → pickup → out → delivered.
// Previously nothing set delivery_partner_id and nothing wrote picked_up, so a
// rider could never take an order and out_for_delivery was unreachable.
router.get("/delivery/available", auth, del.available)
router.get("/delivery/mine", auth, del.myDeliveries)
router.post("/delivery/:id/claim", auth, del.claim)
router.post("/delivery/:id/arrived", auth, del.arrived)
router.post("/delivery/:id/pickup", auth, del.pickup)
router.post("/delivery/:id/out", auth, del.outForDelivery)
router.post("/delivery/:id/delivered", auth, del.delivered)

// Back-compat aliases for the old paths, so any client still calling them keeps
// working. /going is now a no-op alias of /claim: "heading to the restaurant"
// is covered by claiming the order.
router.post("/delivery/:id/accept", auth, del.claim)
router.post("/delivery/:id/going", auth, del.claim)
router.post("/delivery/:id/picked-up", auth, del.pickup)

module.exports = router
