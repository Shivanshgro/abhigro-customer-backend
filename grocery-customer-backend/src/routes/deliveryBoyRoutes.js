const express = require("express")
const unified = require("../controllers/deliveryBoy/allAvailable")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const upload = require("../middleware/upload")
const d = require("../controllers/deliveryBoy/deliveryBoyController")

// Lists
router.get("/available", auth, d.availableOrders)
router.get("/my",        auth, d.myDeliveries)
router.get("/history",   auth, d.history)

// Cross-vertical feeds. These MUST stay above any "/:id" route — Express
// matches in declaration order, so "/:id" would swallow "/all-available".
router.get("/all-available", auth, unified.allAvailable)
router.get("/all-mine",      auth, unified.allMine)

// Pickup
router.post("/:id/pickup",         auth, d.goToPickup)
router.post("/:id/confirm-pickup", auth, d.confirmPickup)
router.post("/:id/picked",         auth, d.markPickedUp)

// Geofence
router.get("/:id/arrival", auth, d.arrivalStatus)

// Delivery completion
router.post("/:id/proof",     auth, upload.any(), d.uploadDeliveryProof)
router.post("/:id/collect",   auth, d.collectPayment)
router.post("/:id/delivered", auth, upload.any(), d.markDelivered)

module.exports = router