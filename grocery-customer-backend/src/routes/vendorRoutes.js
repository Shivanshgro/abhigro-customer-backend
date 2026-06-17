const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const v = require("../controllers/vendor/vendorPanelController")

// Vendor daily duty: manage stock & status (NO manual order accept/reject)
router.get("/inventory",        auth, v.getInventory)
router.post("/inventory",       auth, v.updateInventory)
router.post("/inventory/bulk",  auth, v.bulkUpdateInventory)
router.post("/status",          auth, v.setStatus)
router.get("/orders",           auth, v.myOrders)
router.post("/orders/:id/fulfilled", auth, v.markFulfilled)

module.exports = router
