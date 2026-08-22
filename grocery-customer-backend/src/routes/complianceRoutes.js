// src/routes/complianceRoutes.js
// AbhiGro — compliance routes. Mounted in server.js as /api/compliance
const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const { getProductCompliance, validateProductForPublish } = require("../controllers/product/getProductCompliance")

// Public: customer product page reads compliance sections
router.get("/product/:id", getProductCompliance)

// Admin-only: publish-time validation (auth guards it; admin check per your existing pattern)
router.post("/validate/:id", auth, validateProductForPublish)

module.exports = router
