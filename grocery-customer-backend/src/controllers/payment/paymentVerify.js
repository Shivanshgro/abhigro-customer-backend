const crypto=
require("crypto")

const paymentVerify=
async(req,res)=>{

try{

const{

razorpay_order_id,

razorpay_payment_id,

razorpay_signature

}=req.body

const generated=

crypto

.createHmac(

"sha256",

process.env.RAZORPAY_SECRET

)

.update(

razorpay_order_id+

"|" +

razorpay_payment_id

)

.digest(

"hex"

)

if(

generated===

razorpay_signature

){

return res.json({

success:true,

message:
"Payment Verified"

})

}

res.status(400).json({

success:false,

message:
"Payment Failed"

})

}

catch(error){

console.log(error)

res.status(500).json({

message:
error.message

})

}

}

module.exports=
paymentVerify