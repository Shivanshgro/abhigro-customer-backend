const pool=
require("../../config/db")

const bcrypt=
require("bcrypt")

const jwt=
require("jsonwebtoken")

const login=
async(req,res)=>{

try{

const{

email,
password

}=req.body

const result=

await pool.query(

`
SELECT *

FROM users

WHERE email=$1
`,

[email]

)

if(

result.rows.length===0

){

return res

.status(404)

.json({

message:

"User Not Found"

})

}

const user=

result.rows[0]

const valid=

await bcrypt.compare(

password,

user.password

)

if(

!valid

){

return res

.status(400)

.json({

message:

"Invalid Password"

})

}

const accessToken=

jwt.sign(

{

id:user.id,

email:user.email,

role:

user.role||

"customer"

},

process.env.JWT_SECRET,

{

expiresIn:

"17d"

}

)

const refreshToken=

jwt.sign(

{

id:user.id,

email:user.email,

role:

user.role||

"customer"

},

process.env.JWT_SECRET,

{

expiresIn:

"7d"

}

)

res.json({

success:true,

accessToken,

refreshToken,

user:{

id:user.id,

name:user.name,

email:user.email,

role:

user.role||

"customer"

}

})

}

catch(error){

console.log(error)

res.status(500)

.json({

message:

error.message

})

}

}

module.exports=
login