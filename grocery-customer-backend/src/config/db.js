const {Pool}=
require("pg")

const pool=

new Pool({

host:

process.env.DB_HOST,

port:

process.env.DB_PORT,

database:

process.env.DB_NAME,

user:

process.env.DB_USER,

password:

process.env.DB_PASSWORD

})

pool.connect()

.then(

()=>{

console.log(

"PostgreSQL Connected"

)

}

)

.catch(

(err)=>{

console.log(

"Database Error",

err

)

}

)

module.exports=
pool