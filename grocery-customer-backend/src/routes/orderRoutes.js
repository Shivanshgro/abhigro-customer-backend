const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const createOrder = require("../controllers/order/createOrder")
const getOrders = require("../controllers/order/getOrders")
const trackOrder = require("../controllers/order/trackOrder")

router.post("/", auth, createOrder)
router.get("/", auth, getOrders)          // was /history/:user_id
router.get("/:id", auth, trackOrder)      // was /track/:order_id

module.exports = router
