const cloudinary=
require("../../config/cloudinary")

const uploadImage=
async(req,res)=>{

try{

console.log(
"FILE:",
req.file
)

if(

!req.file

){

return res

.status(400)

.json({

message:

"No File Uploaded"

})

}

const base64=

req.file.buffer

.toString(

"base64"

)

const dataURI=

`data:${
req.file.mimetype
};base64,${
base64
}`

const result=

await cloudinary

.uploader

.upload(

dataURI,

{

folder:

"grocery"

}

)

res.json({

success:true,

image:

result.secure_url

})

}

catch(error){

console.log(error)

res.status(500)

.json({

message:

error.message

})

}

}

module.exports=
uploadImage