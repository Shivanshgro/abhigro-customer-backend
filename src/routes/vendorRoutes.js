const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const upload = require("../middleware/upload")
const v = require("../controllers/vendor/vendorPanelController")

// Vendor daily duty: manage stock & status (NO manual order accept/reject)
router.get("/inventory",        auth, v.getInventory)
// DISABLED: vendors are fulfilment partners; stock is managed by the Admin Panel only.
router.post("/inventory", auth, (req, res) => res.status(403).json({ message: "Inventory is managed by AbhiGro. Vendors cannot update stock." }))
router.post("/inventory/bulk", auth, (req, res) => res.status(403).json({ message: "Inventory is managed by AbhiGro. Vendors cannot update stock." }))
router.post("/status",          auth, v.setStatus)
router.get("/orders",           auth, v.myOrders)
router.post("/orders/:id/fulfilled", auth, v.markFulfilled)
router.post("/orders/:id/packed-photo", auth, upload.any(), v.uploadPackedPhoto)

module.exports = router
