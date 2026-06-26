const { cache } = require('../middleware/cache')
const express = require("express")
const router = express.Router()
const getProducts = require("../controllers/product/getProducts")
const getCategories = require("../controllers/product/getCategories")
const getProductDetails = require("../controllers/product/getProductDetails")
const searchProducts = require("../controllers/product/searchProducts")
const auth = require("../middleware/authMiddleware")
const addReview = require("../controllers/reviews/addReview")
const getReviews = require("../controllers/reviews/getReviews")

router.get("/", cache(300), getProducts)
router.get("/categories", getCategories)
router.get("/search", searchProducts)   // /api/products/search?q=
router.get("/:id/reviews", getReviews)
router.post("/:id/reviews", auth, addReview)
router.get("/:id", getProductDetails)

module.exports = router
