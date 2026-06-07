const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const createOrder = require("../controllers/order/createOrder")
const getOrders = require("../controllers/order/getOrders")
const trackOrder = require("../controllers/order/trackOrder")
const createPayment = require("../controllers/order/createPayment")
const verifyPayment = require("../controllers/order/verifyPayment")

router.post("/create-payment", auth, createPayment)
router.post("/verify-payment", auth, verifyPayment)
router.post("/", auth, createOrder)
router.get("/", auth, getOrders)
router.get("/:id", auth, trackOrder)

module.exports = router