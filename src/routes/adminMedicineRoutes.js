const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const admin = require("../middleware/adminMiddleware")
const a = require("../controllers/medicine/adminMedicineController")

router.use(auth, admin)

router.get("/medicine/orders", a.listOrders)
router.get("/medicine/orders/:id", a.getOrder)
router.get("/pharmacies", a.listPharmacies)
router.post("/pharmacies", a.createPharmacy)
router.put("/pharmacies/:id/approve", a.approvePharmacy)
router.put("/pharmacies/:id/disable", a.disablePharmacy)
router.get("/medicine/settlements", a.listSettlements)
router.post("/medicine/settlements/generate", a.generateSettlement)
router.get("/medicine/reports", a.reports)

module.exports = router
