const pool = require("../../config/db")
const { walletTxn } = require("../../utils/wallet")

// Orders can be cancelled by the customer only before they're out for delivery.
const CANCELLABLE = ["Confirmed", "Pending", "Packed", "Processing"]

// POST /api/orders/:id/cancel  { reason }
const cancelOrder = async (req, res) => {
  const client = await pool.connect()
  try {
    const userId = req.user.id
    const orderId = req.params.id
    const { reason } = req.body

    await client.query("BEGIN")
    const o = await client.query(`SELECT * FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE`, [orderId, userId])
    if (o.rows.length === 0) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Order not found" }) }
    const order = o.rows[0]

    if (order.status === "Cancelled") { await client.query("ROLLBACK"); return res.status(400).json({ message: "Already cancelled" }) }
    if (!CANCELLABLE.includes(order.status)) {
      await client.query("ROLLBACK")
      return res.status(409).json({ message: `Order can't be cancelled once it is ${order.status}` })
    }

    await client.query(
      `UPDATE orders SET status='Cancelled', cancelled_at=NOW(), cancel_reason=$1 WHERE id=$2`,
      [reason || null, orderId]
    )

    // Refund to wallet only if the customer already paid online (not COD).
    let refunded = 0
    const isOnlinePaid = order.payment_status === "Paid" && !/cod/i.test(order.payment_method || "")
    if (isOnlinePaid) {
      refunded = Number(order.total_amount || 0)
      if (refunded > 0) await walletTxn(client, userId, refunded, "refund", `order:${orderId}`)
    }

    await client.query("COMMIT")
    res.json({ success: true, refunded, refund_to: refunded > 0 ? "wallet" : null })
  } catch (e) {
    await client.query("ROLLBACK")
    console.log("cancelOrder error:", e.message)
    res.status(500).json({ message: e.message })
  } finally {
    client.release()
  }
}

// POST /api/orders/:id/items/:itemId/cancel  — cancel a single line item
const cancelItem = async (req, res) => {
  const client = await pool.connect()
  try {
    const userId = req.user.id
    const { id: orderId, itemId } = req.params

    await client.query("BEGIN")
    const o = await client.query(`SELECT * FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE`, [orderId, userId])
    if (o.rows.length === 0) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Order not found" }) }
    const order = o.rows[0]
    if (!CANCELLABLE.includes(order.status)) {
      await client.query("ROLLBACK")
      return res.status(409).json({ message: `Items can't be changed once order is ${order.status}` })
    }

    const it = await client.query(
      `SELECT * FROM order_items WHERE id=$1 AND order_id=$2`, [itemId, orderId]
    )
    if (it.rows.length === 0) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Item not found" }) }
    const item = it.rows[0]
    if (item.cancelled) { await client.query("ROLLBACK"); return res.status(400).json({ message: "Item already cancelled" }) }

    const lineTotal = Number(item.price) * Number(item.quantity)
    await client.query(`UPDATE order_items SET cancelled=true WHERE id=$1`, [itemId])
    await client.query(`UPDATE orders SET total_amount = GREATEST(0, total_amount - $1) WHERE id=$2`, [lineTotal, orderId])

    // If every item is now cancelled, cancel the whole order.
    const remaining = await client.query(
      `SELECT COUNT(*)::int AS n FROM order_items WHERE order_id=$1 AND cancelled=false`, [orderId])
    if (remaining.rows[0].n === 0) {
      await client.query(`UPDATE orders SET status='Cancelled', cancelled_at=NOW() WHERE id=$1`, [orderId])
    }

    // Refund the line value to wallet if online-paid
    let refunded = 0
    const isOnlinePaid = order.payment_status === "Paid" && !/cod/i.test(order.payment_method || "")
    if (isOnlinePaid && lineTotal > 0) {
      refunded = lineTotal
      await walletTxn(client, userId, refunded, "refund", `order:${orderId}:item:${itemId}`)
    }

    await client.query("COMMIT")
    res.json({ success: true, refunded, refund_to: refunded > 0 ? "wallet" : null })
  } catch (e) {
    await client.query("ROLLBACK")
    console.log("cancelItem error:", e.message)
    res.status(500).json({ message: e.message })
  } finally {
    client.release()
  }
}

module.exports = { cancelOrder, cancelItem }
