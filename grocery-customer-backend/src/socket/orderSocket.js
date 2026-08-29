const pool = require("../config/db")

/* ═══════════════════════════════════════════════════════════════════════
   Order socket rooms.

   Replaces the previous handler, which let ANY connected client join
   `order_<id>` for any order just by asking. That exposed a delivery
   partner's live GPS and a customer's address to anyone who guessed an
   order number.

   Now joinOrder checks that the socket belongs to someone entitled to
   watch: the customer who placed it, the assigned rider, the shop owner,
   or an admin. The JWT is already verified in server.js and attached as
   socket.user, so this is a database check, not a new auth system.

   The client contract is unchanged — emit "joinOrder" with an order id,
   listen for "orderUpdated". Existing callers keep working.
   ═══════════════════════════════════════════════════════════════════════ */

async function mayWatch(user, orderId) {
  if (!user || !user.id) return false
  if (user.role === "admin") return true
  try {
    const r = await pool.query(
      `SELECT o.user_id, o.delivery_boy_id, s.owner_user_id
       FROM orders o
       LEFT JOIN shops s ON s.id = o.assigned_shop_id
       WHERE o.id = $1`, [orderId])
    if (r.rows.length === 0) return false
    const o = r.rows[0]
    const me = String(user.id)
    return me === String(o.user_id)
        || me === String(o.delivery_boy_id)
        || me === String(o.owner_user_id)
  } catch (e) {
    console.log("socket mayWatch error:", e.message)
    return false
  }
}

const orderSocket = (io) => {
  io.on("connection", (socket) => {

    socket.on("joinOrder", async (orderId) => {
      const id = String(orderId || "").replace(/\D/g, "")
      if (!id) return
      const ok = await mayWatch(socket.user, id)
      if (!ok) {
        socket.emit("joinDenied", { orderId: id })
        return
      }
      socket.join(`order_${id}`)
      socket.emit("joinedOrder", { orderId: id })
    })

    socket.on("leaveOrder", (orderId) => {
      const id = String(orderId || "").replace(/\D/g, "")
      if (id) socket.leave(`order_${id}`)
    })

    // Kept for backwards compatibility, but a client can no longer inject
    // a status into a room it is not in. Broadcasting the real status is
    // the server's job, from the controllers that actually change it.
    socket.on("updateStatus", (data) => {
      const id = String(data?.orderId || "").replace(/\D/g, "")
      if (!id) return
      if (!socket.rooms.has(`order_${id}`)) return
      io.to(`order_${id}`).emit("orderUpdated", data)
    })

    socket.on("disconnect", () => { /* rooms clean themselves up */ })
  })
}

module.exports = orderSocket
