const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const upload = require("../middleware/upload")
const d = require("../controllers/medicine/deliveryMedicineController")

// mounted at /api/delivery/medicine-orders
router.get("/packed", auth, d.packedOrders)
router.get("/my", auth, d.myOrders)
router.put("/:id/accept", auth, d.accept)
router.put("/:id/pickup-confirm", auth, d.pickupConfirm)
router.put("/:id/out-for-delivery", auth, d.outForDelivery)
router.post("/:id/upload-delivery-photo", auth, upload.any(), d.uploadDeliveryPhoto)
router.put("/:id/cash-collected", auth, d.cashCollected)
router.put("/:id/delivered", auth, upload.any(), d.delivered)

module.exports = router
