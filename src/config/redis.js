const redis=
require("redis")

const client=

redis.createClient({

url:

"redis://localhost:6379"

})

client.on(

"error",

(err)=>{

console.log(

"Redis Error:",

err.message

)

}

)

client.on(

"connect",

()=>{

console.log(

"Redis Connected"

)

}

)

async function connectRedis(){

try{

await client.connect()

}

catch(error){

console.log(

error.message

)

}

}

connectRedis()

module.exports=
client