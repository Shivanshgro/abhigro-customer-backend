const express = require("express")
const unified = require("../controllers/deliveryBoy/allAvailable")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const upload = require("../middleware/upload")
const d = require("../controllers/deliveryBoy/deliveryBoyController")

router.get("/available", auth, d.availableOrders)
router.get("/my",        auth, d.myDeliveries)
router.get("/history",   auth, d.history)

router.post("/:id/pickup",         auth, d.goToPickup)
router.post("/:id/confirm-pickup", auth, d.confirmPickup)
router.post("/:id/picked",         auth, d.markPickedUp)

router.get("/:id/arrival", auth, d.arrivalStatus)

router.post("/:id/proof",     auth, upload.any(), d.uploadDeliveryProof)
router.post("/:id/collect",   auth, d.collectPayment)
router.post("/:id/delivered", auth, upload.any(), d.markDelivered)

router.get("/all-available", auth, unified.allAvailable)
router.get("/all-mine", auth, unified.allMine)

module.exports = router