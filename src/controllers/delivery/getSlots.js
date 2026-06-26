const pool=
require("../../config/db")

const getSlots=
async(req,res)=>{

try{

const slots=

await pool.query(

`

SELECT *

FROM delivery_slots

WHERE available=true

ORDER BY id

`

)

res.json({

success:true,

slots:
slots.rows

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
getSlots