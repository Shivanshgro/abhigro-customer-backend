const Razorpay=
require("razorpay")

let razorpay

if(

process.env.RAZORPAY_KEY &&

process.env.RAZORPAY_SECRET

){

razorpay=

new Razorpay({

key_id:
process.env.RAZORPAY_KEY,

key_secret:
process.env.RAZORPAY_SECRET

})

}

const paymentInit=
async(req,res)=>{

try{

if(!razorpay){

return res.json({

success:true,

message:

"Razorpay Keys Missing"

})

}

const{

amount

}=req.body

const order=

await razorpay.orders.create({

amount:
amount*100,

currency:
"INR",

receipt:
`receipt_${Date.now()}`

})

res.json({

success:true,

order

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
paymentInit