const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const login = require("../controllers/auth/loginController")
const register = require("../controllers/auth/registerController")
const refreshToken = require("../controllers/auth/refreshTokenController")
const { getProfile, updateProfile } = require("../controllers/auth/profileController")

router.post("/login", login)
router.post("/register", register)
router.post("/refresh", refreshToken)
router.get("/profile", auth, getProfile)   // GET /api/auth/profile
router.put("/profile", auth, updateProfile) // PUT /api/auth/profile

module.exports = router
