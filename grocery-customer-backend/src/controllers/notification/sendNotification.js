const pool=
require("../../config/db")

const sendNotification=
async(req,res)=>{

try{

const{

user_id,
title,
message

}=req.body

const result=

await pool.query(

`
INSERT INTO notifications(

user_id,
title,
message

)

VALUES(

$1,$2,$3

)

RETURNING *

`,

[
user_id,
title,
message
]

)

res.json({

success:true,

notification:
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
sendNotification