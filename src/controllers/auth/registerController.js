const bcrypt=require("bcrypt")
const pool=require("../../config/db")

const register=async(req,res)=>{

try{

const{
name,
email,
phone,
password
}=req.body

if(
!name||
!email||
!password
){

return res.status(400).json({

message:"Missing Fields"

})

}

const exists=
await pool.query(

"SELECT * FROM users WHERE email=$1",

[email]

)

if(exists.rows.length>0){

return res.status(400).json({

message:"User Already Exists"

})

}

const hashed=
await bcrypt.hash(
password,
10
)

const user=
await pool.query(

`INSERT INTO users
(name,email,phone,password)
VALUES($1,$2,$3,$4)
RETURNING id,name,email,phone`,

[
name,
email,
phone,
hashed
]

)

res.status(201).json({

success:true,

user:user.rows[0]

})

}

catch(error){

console.log(error)

res.status(500).json({

message:error.message

})

}

}

module.exports=register