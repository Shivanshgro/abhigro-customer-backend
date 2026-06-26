const jwt=
require("jsonwebtoken")

const refresh=
async(req,res)=>{

try{

const {

refreshToken

}=req.body

if(

!refreshToken

){

return res

.status(401)

.json({

message:

"No Refresh Token"

})

}

jwt.verify(

refreshToken,

process.env.JWT_SECRET,

(err,user)=>{

if(

err

){

return res

.status(403)

.json({

message:

"Invalid Refresh Token"

})

}

const accessToken=

jwt.sign(

{

id:user.id,

email:user.email,

role:user.role

},

process.env.JWT_SECRET,

{

expiresIn:"15m"

}

)

res.json({

success:true,

accessToken

})

}

)

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
refresh