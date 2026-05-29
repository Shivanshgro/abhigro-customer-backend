const pool=
require("../../config/db")

const removeCart=
async(req,res)=>{

try{

const{
id
}=req.params

await pool.query(

`
DELETE FROM cart_items

WHERE id=$1
`,

[id]

)

res.json({

success:true,

message:
"Removed"

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

module.exports=removeCart