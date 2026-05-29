const pool=require("../../config/db")

const getCategories=async(req,res)=>{

try{

const categories=

await pool.query(

"SELECT * FROM categories ORDER BY id ASC"

)

res.json({

success:true,

categories:
categories.rows

})

}

catch(error){

console.log(error)

res.status(500).json({

message:error.message

})

}

}

module.exports=
getCategories