// ─────────────────────────────────────────────────────────────────────────────
// Tiny holder for the socket.io server instance so controllers can emit live
// updates without importing server.js. All helpers no-op safely if io is unset.
// ─────────────────────────────────────────────────────────────────────────────
let _io = null

function setIO(io) {
  _io = io
}

function getIO() {
  return _io
}

// Notify everyone watching a specific order room (joinOrder => `order_<id>`)
function emitOrderUpdate(orderId, payload = {}) {
  try {
    if (_io) _io.to(`order_${orderId}`).emit("orderUpdated", { orderId, ...payload })
  } catch (e) { /* ignore */ }
}

// Broadcast that a packed order is ready for any available delivery boy
function emitDeliveryAvailable(payload = {}) {
  try {
    if (_io) _io.emit("deliveryAvailable", payload)
  } catch (e) { /* ignore */ }
}

module.exports = { setIO, getIO, emitOrderUpdate, emitDeliveryAvailable }
