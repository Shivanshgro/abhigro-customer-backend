const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const registerRestaurant = require("../controllers/restaurant/registerRestaurant")
const { myRestaurant, setOnline } = require("../controllers/restaurant/myRestaurant")
const menu = require("../controllers/restaurant/menu")
const ro = require("../controllers/restaurant/restaurantOrders")
const extras = require("../controllers/restaurant/restaurantExtras")
const settings = require("../controllers/restaurant/restaurantSettings")

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

// Profile, hours, staff
router.put("/profile", auth, settings.updateProfile)
router.get("/hours", auth, settings.getHours)
router.put("/hours", auth, settings.setHours)
router.post("/closed-today", auth, settings.setClosedToday)
router.get("/staff", auth, settings.getStaff)
router.post("/staff", auth, settings.addStaff)
router.delete("/staff/:id", auth, settings.removeStaff)

// Menu extras
router.post("/item/:id/flags", auth, settings.setItemFlags)
router.post("/item/:id/move", auth, settings.moveItem)
router.get("/item/:id/options", auth, settings.getItemOptions)
router.post("/item/:id/options", auth, settings.addItemOptionGroup)
router.delete("/options/:groupId", auth, settings.deleteOptionGroup)

module.exports = router
