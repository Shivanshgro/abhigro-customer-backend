const express = require("express")
const router = express.Router()
const getProducts = require("../controllers/product/getProducts")
const getCategories = require("../controllers/product/getCategories")
const getProductDetails = require("../controllers/product/getProductDetails")
const searchProducts = require("../controllers/product/searchProducts")

router.get("/", getProducts)
router.get("/categories", getCategories)
router.get("/search", searchProducts)   // /api/products/search?q=
router.get("/:id", getProductDetails)

module.exports = router
