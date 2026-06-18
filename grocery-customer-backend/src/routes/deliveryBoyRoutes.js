const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const d = require("../controllers/deliveryBoy/deliveryBoyController")

router.get("/available", auth, d.availableOrders)
router.get("/my", auth, d.myDeliveries)
router.post("/:id/pickup", auth, d.goToPickup)
router.post("/:id/picked", auth, d.markPickedUp)
router.post("/:id/delivered", auth, d.markDelivered)

module.exports = router
