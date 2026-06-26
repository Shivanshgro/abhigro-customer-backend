const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const sendNotification = require("../controllers/notification/sendNotification")
const getNotifications = require("../controllers/notification/getNotifications")

router.post("/", auth, sendNotification)
router.get("/", auth, getNotifications)   // was /:user_id (no auth)

module.exports = router
