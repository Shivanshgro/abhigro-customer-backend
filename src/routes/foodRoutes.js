const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const browse = require("../controllers/foodCustomer/browse")
const order = require("../controllers/foodCustomer/placeOrder")
const del = require("../controllers/foodCustomer/foodDelivery")

// Customer
router.get("/restaurants", browse.nearbyRestaurants)
router.get("/restaurants/:id/menu", browse.restaurantMenu)
router.post("/order", auth, order.placeOrder)
router.post("/order/:id/verify", auth, order.verifyPayment)
router.get("/my-orders", auth, order.myOrders)
router.post("/order/:id/rate", auth, del.rate)

// Delivery partner
router.get("/delivery/available", auth, del.available)
router.post("/delivery/:id/accept", auth, del.acceptPickup)
router.post("/delivery/:id/going", auth, del.goingToRestaurant)
router.post("/delivery/:id/picked-up", auth, del.pickedUp)
router.post("/delivery/:id/out", auth, del.outForDelivery)
router.post("/delivery/:id/delivered", auth, del.delivered)

module.exports = router
