const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const registerRestaurant = require("../controllers/restaurant/registerRestaurant")
const { myRestaurant, setOnline } = require("../controllers/restaurant/myRestaurant")
const menu = require("../controllers/restaurant/menu")
const ro = require("../controllers/restaurant/restaurantOrders")

router.post("/register", auth, registerRestaurant)
router.get("/me", auth, myRestaurant)
router.post("/online", auth, setOnline)

router.post("/category", auth, menu.addCategory)
router.get("/categories", auth, menu.getCategories)
router.delete("/category/:id", auth, menu.deleteCategory)

router.post("/item", auth, menu.addItem)
router.put("/item/:id", auth, menu.editItem)
router.post("/item/:id/availability", auth, menu.setAvailability)
router.delete("/item/:id", auth, menu.deleteItem)
router.get("/items", auth, menu.getMyItems)

router.get("/orders", auth, ro.getOrders)
router.post("/orders/:id/accept", auth, ro.accept)
router.post("/orders/:id/reject", auth, ro.reject)
router.post("/orders/:id/preparing", auth, ro.preparing)
router.post("/orders/:id/ready", auth, ro.ready)
router.get("/payouts", auth, ro.payouts)

module.exports = router
