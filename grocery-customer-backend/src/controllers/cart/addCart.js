const pool=
require("../../config/db")

const addCart=
async(req,res)=>{

try{

const{
user_id,
product_id,
quantity
}=req.body

const cart=

await pool.query(

`
SELECT *

FROM cart

WHERE user_id=$1
`,

[user_id]

)

let cartId

if(
cart.rows.length===0
){

const newCart=

await pool.query(

`
INSERT INTO cart
(user_id)

VALUES($1)

RETURNING id
`,

[user_id]

)

cartId=
newCart.rows[0].id

}

else{

cartId=
cart.rows[0].id

}

await pool.query(

`
INSERT INTO cart_items
(
cart_id,
product_id,
quantity
)

VALUES
($1,$2,$3)
`,

[
cartId,
product_id,
quantity
]

)

res.json({

success:true,

message:
"Added To Cart"

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
addCart