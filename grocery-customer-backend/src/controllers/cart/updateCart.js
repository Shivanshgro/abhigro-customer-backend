const pool=
require("../../config/db")

const updateCart=
async(req,res)=>{

try{

const{
cart_item_id,
quantity
}=req.body

const result=

await pool.query(

`
UPDATE cart_items

SET quantity=$1

WHERE id=$2

RETURNING *
`,

[
quantity,
cart_item_id
]

)

if(
result.rows.length===0
){

return res.status(404).json({

message:
"Cart Item Not Found"

})

}

res.json({

success:true,

message:
"Cart Updated",

item:
result.rows[0]

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

module.exports=updateCart