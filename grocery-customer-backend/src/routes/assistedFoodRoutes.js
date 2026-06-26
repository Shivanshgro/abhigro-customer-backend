const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const createAssistedOrder = require("../controllers/assistedFood/createAssistedOrder")
const myAssistedOrders = require("../controllers/assistedFood/myAssistedOrders")
const pf = require("../controllers/assistedFood/partnerFlow")
const pay = require("../controllers/assistedFood/payments")

// Customer
router.post("/order", auth, createAssistedOrder)
router.get("/my", auth, myAssistedOrders)

// Partner
router.get("/available", auth, pf.available)
router.post("/:id/accept", auth, pf.accept)
router.post("/:id/reached", auth, pf.reached)
router.post("/:id/confirm-price", auth, pf.confirmPrice)
router.post("/:id/picked-up", auth, pf.pickedUp)
router.post("/:id/out-for-delivery", auth, pf.outForDelivery)
router.post("/:id/delivered", auth, pf.delivered)

// Payments
router.post("/:id/customer-link", auth, pay.customerLink)
router.post("/:id/verify-food-payment", auth, pay.verifyFoodPayment)
router.post("/:id/pay-vendor", auth, pay.payVendor)
router.post("/:id/vendor-proof", auth, pay.vendorProof)

module.exports = router
