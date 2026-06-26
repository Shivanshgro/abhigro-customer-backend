const express=
require("express")

const router=
express.Router()

const auth=
require(
"../middleware/authMiddleware"
)

const upload=
require(
"../middleware/upload"
)

const uploadImage=
require(
"../controllers/upload/uploadImage"
)

router.post(

"/",

auth,

upload.single(

"image"

),

uploadImage

)

module.exports=
router