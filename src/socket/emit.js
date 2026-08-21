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

// Broadcast a brand-new order so the Admin dashboard updates without refresh
function emitNewOrder(payload = {}) {
  try {
    if (_io) _io.emit("newOrder", payload)
  } catch (e) { /* ignore */ }
}

// Emit to one restaurant's room only. Without this, emitNewOrder broadcasts to
// every connected client, so every restaurant would see every other
// restaurant's orders.
// Tell every rider an order has been claimed, so it disappears from their list
// instead of them tapping it and being told it is gone.
function emitOrderTaken(payload = {}) {
  try {
    if (_io) _io.emit("orderTaken", payload)
  } catch (e) { /* ignore */ }
}

function emitToRestaurant(restaurantId, event, payload = {}) {
  try {
    if (_io) _io.to(`restaurant_${restaurantId}`).emit(event, payload)
  } catch (e) { /* ignore */ }
}

module.exports = { setIO, getIO, emitOrderUpdate, emitDeliveryAvailable, emitNewOrder, emitToRestaurant, emitOrderTaken }
