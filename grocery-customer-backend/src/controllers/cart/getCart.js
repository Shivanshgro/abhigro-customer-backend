const pool =
require("../../config/db")

const getCart =
async(req,res)=>{

try{

const userId=

req.user.id

const result=

await pool.query(

`
SELECT

cart.id,
cart.quantity,

products.id
AS product_id,

products.name,

products.price,

products.image

FROM cart

JOIN products

ON cart.product_id=

products.id

WHERE cart.user_id=$1
`,

[userId]

)

res.json({

success:true,

cart:

result.rows

})

}

catch(error){

console.log(error)

res.status(500).json({

message:

"Server Error"

})

}

}

module.exports=
getCart