const express = require("express")
const router = express.Router()
const cat = require("../controllers/catalog/structure")

router.get("/categories", cat.getCategories)
router.get("/subcategories", cat.getSubcategories)
router.get("/brands", cat.getBrands)

module.exports = router
