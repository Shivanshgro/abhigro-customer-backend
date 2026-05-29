const express=
require("express")

const router=
express.Router()

const auth=
require(
"../middleware/authMiddleware"
)

const admin=
require(
"../middleware/adminMiddleware"
)

const dashboardStats=

require(

"../controllers/admin/dashboardStats"

)

router.get(

"/dashboard",

auth,

admin,

dashboardStats

)

module.exports=
router