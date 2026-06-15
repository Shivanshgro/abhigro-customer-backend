const express = require("express")
const router = express.Router()
const supplierSync = require("../controllers/supplier/supplierSync")

// Supplier API key middleware
function supplierAuth(req, res, next) {
  const apiKey = req.headers["x-supplier-key"]
  if (!apiKey || apiKey !== process.env.SUPPLIER_API_KEY) {
    return res.status(401).json({ message: "Invalid supplier API key" })
  }
  next()
}

// POST /api/supplier/sync — supplier pushes their catalog
router.post("/sync", supplierAuth, supplierSync)

module.exports = router
