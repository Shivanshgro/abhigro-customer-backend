const admin=
(req,res,next)=>{

console.log(
req.user
)

if(

!req.user ||

req.user.role!=="admin"

){

return res

.status(403)

.json({

message:

"Admin Only"

})

}

next()

}

module.exports=
admin