const orderSocket=(io)=>{

io.on(

"connection",

(socket)=>{

console.log(

"User Connected",

socket.id

)

socket.on(

"joinOrder",

(orderId)=>{

socket.join(

`order_${orderId}`

)

}

)

socket.on(

"updateStatus",

(data)=>{

io.to(

`order_${data.orderId}`

)

.emit(

"orderUpdated",

data

)

}

)

socket.on(

"disconnect",

()=>{

console.log(

"User Disconnected"

)

}

)

}

)

}

module.exports=orderSocket