const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const upload = require("../middleware/upload")
const c = require("../controllers/medicine/customerMedicineController")

// Public catalogue
router.get("/products", c.listProducts)
router.get("/products/:id", c.getProduct)

// Public pharmacy self-registration (pending admin approval)
const onboard = require("../controllers/medicine/pharmacyOnboardController")
router.post("/pharmacy/register", onboard.registerPharmacy)

// Prescription upload before placing an order (returns a URL)
router.post("/prescription/upload", auth, upload.any(), c.uploadPrescriptionFile)

// Orders (customer)
router.post("/orders", auth, c.createOrder)
router.post("/orders/:id/upload-prescription", auth, upload.any(), c.uploadPrescription)
router.get("/orders/my-orders", auth, c.myOrders)
router.get("/orders/:id", auth, c.getOrder)
router.get("/orders/:id/invoice", auth, c.invoice)
router.get("/orders/:id/service-receipt", auth, c.serviceReceipt)

module.exports = router