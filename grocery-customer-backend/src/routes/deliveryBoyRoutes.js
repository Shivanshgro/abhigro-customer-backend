const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const upload = require("../middleware/upload")
const d = require("../controllers/deliveryBoy/deliveryBoyController")

// Lists
router.get("/available", auth, d.availableOrders)   // packed & unassigned
router.get("/my",        auth, d.myDeliveries)       // my active deliveries
router.get("/history",   auth, d.history)            // my completed deliveries

// Pickup
router.post("/:id/pickup",         auth, d.goToPickup)      // claim/assign to me
router.post("/:id/confirm-pickup", auth, d.confirmPickup)   // confirm with order number -> Out For Delivery
router.post("/:id/picked",         auth, d.markPickedUp)    // legacy simple pickup (kept)

// Delivery completion
router.post("/:id/proof",     auth, upload.any(), d.uploadDeliveryProof) // delivery proof photo
router.post("/:id/collect",   auth, d.collectPayment)                    // COD cash collected
router.post("/:id/delivered", auth, upload.any(), d.markDelivered)       // proof + COD + Completed

module.exports = router
