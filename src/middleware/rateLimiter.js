const rateLimit=
require(
"express-rate-limit"
)

const apiLimiter=

rateLimit({

windowMs:

15*60*1000,

max:1000,

message:{

success:false,

message:

"Too Many Requests. Try Again Later"

},

standardHeaders:true,

legacyHeaders:false

})

module.exports=
apiLimiter