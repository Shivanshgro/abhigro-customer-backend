// ────────────────────────────────────────────────────────────────────────────
// foodOrderState.js
//
// The ONLY place allowed to change food_orders.order_status.
//
// Every route calls transition(). It validates that the move is legal, that the
// caller is entitled to make it, writes the audit row in the SAME transaction as
// the status change, and emits realtime AFTER the commit — never inside it.
//
// State names are the ones the existing code already uses (lowercase). They were
// not renamed: renaming would mean changing placeOrder, verifyPayment,
// restaurantOrders, foodDelivery and any frontend string comparison all at once.
// The value here is having one gatekeeper, not new spelling.
//
// ADDITIVE: this file changes nothing on its own. Nothing breaks until a route
// is rewired to call it.
// ────────────────────────────────────────────────────────────────────────────

const pool = require("../config/db")

// ── the machine ────────────────────────────────────────────────────────────
// 'placed' is what placeOrder writes for COD / when Razorpay is unconfigured.
// 'payment_successful' is kept as an accepted alias because restaurantOrders
// already reads it, even though nothing currently writes it.
const TRANSITIONS = {
  placed:               ["restaurant_pending", "cancelled"],
  payment_successful:   ["restaurant_pending", "cancelled"],
  restaurant_pending:   ["restaurant_accepted", "cancelled"],
  restaurant_accepted:  ["preparing", "cancelled"],
  preparing:            ["food_ready", "cancelled"],
  food_ready:           ["delivery_assigned", "picked_up"],
  delivery_assigned:    ["delivery_arrived", "food_ready"],   // rider drops → reoffer
  delivery_arrived:     ["picked_up"],
  picked_up:            ["out_for_delivery", "delivered"],
  out_for_delivery:     ["delivered"],
  delivered:            [],
  cancelled:            ["refunded"],
  refunded:             [],
}

// who is allowed to move the order INTO each state
const ALLOWED_ACTOR = {
  restaurant_pending:  ["system", "admin"],
  restaurant_accepted: ["restaurant", "admin"],
  preparing:           ["restaurant", "admin"],
  food_ready:          ["restaurant", "admin"],
  delivery_assigned:   ["system", "rider", "admin"],
  delivery_arrived:    ["rider", "admin"],
  picked_up:           ["rider", "restaurant", "admin"],
  out_for_delivery:    ["rider", "admin"],
  delivered:           ["rider", "admin"],
  cancelled:           ["customer", "restaurant", "admin", "system"],
  refunded:            ["admin", "system"],
}

// a customer may only cancel before the kitchen starts cooking
const CUSTOMER_CANCELLABLE = ["placed", "payment_successful", "restaurant_pending", "restaurant_accepted"]

function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to)
}

class TransitionError extends Error {
  constructor(message, code = 409) { super(message); this.code = code }
}

/**
 * Move an order to a new state.
 *
 * @param {number}  orderId
 * @param {string}  to          target order_status
 * @param {string}  actorType   customer | restaurant | rider | admin | system
 * @param {number}  actorId     the acting user id (null for system)
 * @param {object}  scope       ownership guard, e.g. { restaurantId } or { riderId } or { customerId }
 * @param {object}  set         extra columns to write, e.g. { prep_minutes: 15 }
 * @param {string}  note        free text stored on the event row
 * @returns {object} the updated order row
 */
async function transition({ orderId, to, actorType = "system", actorId = null, scope = {}, set = {}, note = null }) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // lock the row so two callers cannot both read the same 'from' state
    const cur = await client.query(
      `SELECT id, restaurant_id, customer_id, delivery_partner_id, order_status
         FROM food_orders WHERE id = $1 FOR UPDATE`, [orderId])
    if (cur.rows.length === 0) throw new TransitionError("Order not found", 404)

    const order = cur.rows[0]
    const from = order.order_status

    // ── ownership ──────────────────────────────────────────────────────────
    if (scope.restaurantId != null && order.restaurant_id !== scope.restaurantId)
      throw new TransitionError("This order belongs to another restaurant", 403)
    if (scope.customerId != null && order.customer_id !== scope.customerId)
      throw new TransitionError("This is not your order", 403)
    if (scope.riderId != null && order.delivery_partner_id != null && order.delivery_partner_id !== scope.riderId)
      throw new TransitionError("This order is assigned to another rider", 403)

    // ── legality ───────────────────────────────────────────────────────────
    if (from === to) throw new TransitionError(`Order is already ${to}`, 409)
    if (!canTransition(from, to))
      throw new TransitionError(`Cannot go from ${from} to ${to}`, 409)

    const allowed = ALLOWED_ACTOR[to]
    if (allowed && !allowed.includes(actorType))
      throw new TransitionError(`A ${actorType} cannot move an order to ${to}`, 403)

    if (to === "cancelled" && actorType === "customer" && !CUSTOMER_CANCELLABLE.includes(from))
      throw new TransitionError("Too late to cancel — the kitchen has started", 409)

    // ── write ──────────────────────────────────────────────────────────────
    const cols = ["order_status = $2", "updated_at = NOW()"]
    const vals = [orderId, to]
    let n = 3
    for (const [k, v] of Object.entries(set)) {
      cols.push(`${k} = $${n++}`)      // keys are literals from our own routes, never user input
      vals.push(v)
    }
    // stamp the timeline columns automatically
    const STAMP = { restaurant_accepted: "accepted_at", food_ready: "ready_at",
                    picked_up: "picked_up_at", delivered: "delivered_at" }
    if (STAMP[to] && !(STAMP[to] in set)) cols.push(`${STAMP[to]} = NOW()`)

    const upd = await client.query(
      `UPDATE food_orders SET ${cols.join(", ")} WHERE id = $1 RETURNING *`, vals)

    // audit row is part of the same transaction — if this fails, the move rolls back
    await client.query(
      `INSERT INTO food_order_events (order_id, from_status, to_status, actor_type, actor_id, note)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [orderId, from, to, actorType, actorId, note])

    await client.query("COMMIT")

    const updated = upd.rows[0]
    emitAfterCommit(updated, from, to)
    return updated

  } catch (e) {
    try { await client.query("ROLLBACK") } catch (_) {}
    throw e
  } finally {
    client.release()
  }
}

// realtime happens after the commit, so nothing is announced that did not persist
function emitAfterCommit(order, from, to) {
  try {
    const { emitOrderUpdate, emitDeliveryAvailable, emitToRestaurant } = require("../socket/emit")

    // customer / order room — same key the existing controllers already use
    emitOrderUpdate(`food_${order.id}`, { type: "status", order_status: to, from })

    // the restaurant's own room, if emit.js has been extended with it
    if (typeof emitToRestaurant === "function") {
      emitToRestaurant(order.restaurant_id, "foodOrderUpdate",
        { order_id: order.id, order_status: to, from })
      if (to === "restaurant_pending") {
        emitToRestaurant(order.restaurant_id, "newFoodOrder", { order_id: order.id, order })
      }
    }

    // offer the run to delivery partners
    if (to === "food_ready") {
      emitDeliveryAvailable({ type: "food", order_id: order.id, restaurant_id: order.restaurant_id })
    }
  } catch (e) {
    console.log("food state emit (non-blocking):", e.message)
  }
}

/** Read the audit trail — this is what the customer tracking screen renders. */
async function history(orderId) {
  const r = await pool.query(
    `SELECT from_status, to_status, actor_type, note, created_at
       FROM food_order_events WHERE order_id = $1 ORDER BY id ASC`, [orderId])
  return r.rows
}

module.exports = { transition, history, canTransition, TRANSITIONS, TransitionError }
