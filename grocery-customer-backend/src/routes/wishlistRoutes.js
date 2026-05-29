const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const addWishlist = require("../controllers/wishlist/addWishlist")
const getWishlist = require("../controllers/wishlist/getWishlist")
const removeWishlist = require("../controllers/wishlist/removeWishlist")

router.post("/", auth, addWishlist)
router.get("/", auth, getWishlist)       // was /:user_id
router.delete("/:id", auth, removeWishlist)

module.exports = router
