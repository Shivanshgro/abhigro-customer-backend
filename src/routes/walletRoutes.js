const express = require("express")
const router = express.Router()
const auth = require("../middleware/authMiddleware")
const getWallet = require("../controllers/wallet/getWallet")
const applyReferral = require("../controllers/wallet/applyReferral")

router.get("/", auth, getWallet)
router.post("/apply-referral", auth, applyReferral)

module.exports = router
