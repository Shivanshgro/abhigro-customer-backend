const pool=
require("../../config/db")

const updateAddress=
async(req,res)=>{

try{

console.log(
"BODY:",
req.body
)

const{

id,
user_id,
full_name,
phone,
address_line,
city,
state,
pincode

}=req.body

const result=

await pool.query(

`
UPDATE addresses

SET

user_id=
COALESCE(
$1,
user_id
),

full_name=$2,

phone=$3,

address_line=$4,

city=$5,

state=$6,

pincode=$7

WHERE id=$8

RETURNING *
`,

[
user_id,
full_name,
phone,
address_line,
city,
state,
pincode,
id
]

)

if(
result.rows.length===0
){

return res.status(404).json({

message:
"Address Not Found"

})

}

res.json({

success:true,

address:
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

module.exports=
updateAddress