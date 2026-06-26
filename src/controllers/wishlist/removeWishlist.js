const pool=
require("../../config/db")

const removeWishlist=
async(req,res)=>{

try{

const{
id
}=req.params

await pool.query(

`
DELETE FROM wishlist

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

module.exports=
removeWishlist