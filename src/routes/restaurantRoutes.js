const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const registerRestaurant = require("../controllers/restaurant/registerRestaurant")
const { myRestaurant, setOnline } = require("../controllers/restaurant/myRestaurant")
const menu = require("../controllers/restaurant/menu")
const ro = require("../controllers/restaurant/restaurantOrders")
const extras = require("../controllers/restaurant/restaurantExtras")

router.post("/register", registerRestaurant)
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

// Offers
router.get("/offers", auth, extras.getOffers)
router.post("/offers", auth, extras.createOffer)
router.post("/offers/:id/toggle", auth, extras.toggleOffer)
router.delete("/offers/:id", auth, extras.deleteOffer)

// Reviews
router.get("/reviews", auth, extras.getReviews)
router.post("/reviews/:id/reply", auth, extras.replyReview)

// Reports
router.get("/reports", auth, extras.getReports)

module.exports = router
