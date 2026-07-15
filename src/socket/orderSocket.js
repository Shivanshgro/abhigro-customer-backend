// Real-time order + notification socket.
// Anonymous clients may still track a specific order room (as before).
// Authenticated clients (JWT verified in server.js io.use) auto-join a private room
// so future targeted emits reach only them.
const orderSocket = (io) => {
  io.on("connection", (socket) => {
    // authenticated -> private per-user + per-role rooms
    if (socket.user && socket.user.id) {
      socket.join(`user_${socket.user.id}`)
      if (socket.user.role) socket.join(`role_${socket.user.role}`)
    }

    // order tracking room — validate the id is a plain number to prevent room abuse
    socket.on("joinOrder", (orderId) => {
      const id = String(orderId || "").replace(/[^0-9]/g, "")
      if (id) socket.join(`order_${id}`)
    })

    // NOTE: clients can no longer broadcast arbitrary status updates.
    // Status changes are emitted server-side from controllers (emit.js) after
    // the change is validated and written to the DB — never trusted from the client.
  })
}
module.exports = orderSocket
