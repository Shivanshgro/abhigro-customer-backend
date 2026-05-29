const express=
require("express")

const router=
express.Router()

const paymentInit=
require(
"../controllers/payment/paymentInit"
)

const paymentVerify=
require(
"../controllers/payment/paymentVerify"
)

router.post(
"/init",
paymentInit
)

router.post(
"/verify",
paymentVerify
)

module.exports=
router