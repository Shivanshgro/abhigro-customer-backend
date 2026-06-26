const pool=
require("../../config/db")

const dashboardStats=
async(req,res)=>{

try{

const users=

await pool.query(

`

SELECT COUNT(*)

FROM users

`

)

const orders=

await pool.query(

`

SELECT COUNT(*)

FROM orders

`

)

const products=

await pool.query(

`

SELECT COUNT(*)

FROM products

`

)

const revenue=

await pool.query(

`

SELECT

COALESCE(

SUM(total_amount),

0

)

AS total

FROM orders

`

)

res.json({

success:true,

stats:{

users:

users.rows[0]

.count,

orders:

orders.rows[0]

.count,

products:

products.rows[0]

.count,

revenue:

revenue.rows[0]

.total

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
dashboardStats