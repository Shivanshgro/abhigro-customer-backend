const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const upload = require("../middleware/upload")
const { pharmacyOnly } = require("../middleware/pharmacyMiddleware")
const p = require("../controllers/medicine/pharmacyController")

router.use(auth, pharmacyOnly)

router.get("/orders", p.listOrders)
router.get("/orders/:id", p.getOrder)
router.put("/orders/:id/approve-prescription", p.approvePrescription)
router.put("/orders/:id/reject-prescription", p.rejectPrescription)
router.put("/orders/:id/request-clear-prescription", p.requestClearPrescription)
router.put("/orders/:id/medicine-not-available", p.medicineNotAvailable)
router.put("/orders/:id/approve-order", p.approveOrder)
router.post("/orders/:id/upload-packed-photo", upload.any(), p.uploadPackedPhoto)
router.post("/orders/:id/invoice", p.saveInvoice)
router.put("/orders/:id/packed", p.markPacked)

module.exports = router
