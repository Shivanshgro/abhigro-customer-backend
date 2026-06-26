const pool = require("../../config/db")

// GET /api/orders/:id/invoice
// Returns a full itemised bill. Accessible by the order's customer OR the vendor
// whose shop the order is assigned to. Includes line items, subtotal, delivery fee,
// platform fee, discount, total, payment method/status, customer + shop details.
const getInvoice = async (req, res) => {
  try {
    const userId = req.user.id

    const oq = await pool.query(
      `SELECT o.*, 
              cu.name AS customer_name, cu.phone AS customer_phone, cu.email AS customer_email,
              a.address_line, a.pincode AS address_pincode, a.phone AS address_phone,
              s.shop_name, s.address AS shop_address, s.phone AS shop_phone, s.owner_user_id
       FROM orders o
       LEFT JOIN users cu    ON cu.id = o.user_id
       LEFT JOIN addresses a ON a.id = o.address_id
       LEFT JOIN shops s     ON s.id = o.assigned_shop_id
       WHERE o.id = $1`, [req.params.id])
    if (oq.rows.length === 0) return res.status(404).json({ message: "Order not found" })
    const o = oq.rows[0]

    // Access: the customer who placed it, or the vendor who owns the assigned shop
    const isCustomer = String(o.user_id) === String(userId)
    const isVendor   = String(o.owner_user_id) === String(userId)
    if (!isCustomer && !isVendor) return res.status(403).json({ message: "Not authorised to view this invoice" })

    const itemsQ = await pool.query(
      `SELECT oi.product_id, p.name, p.unit, p.image,
              oi.quantity, oi.price,
              (oi.price * oi.quantity) AS line_total,
              COALESCE(oi.cancelled,false) AS cancelled
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id=$1 ORDER BY p.name`, [req.params.id])
    const items = itemsQ.rows

    const subtotal = items
      .filter(i => !i.cancelled)
      .reduce((s, i) => s + Number(i.line_total), 0)
    const deliveryFee = Number(o.delivery_fee || 0)
    const platformFee = Number(o.platform_fee || 0)
    const total = Number(o.total_amount || 0)
    // discount = whatever doesn't add up (coupon/wallet), never negative
    const discount = Math.max(0, Math.round((subtotal + deliveryFee + platformFee - total) * 100) / 100)

    res.json({
      invoice: {
        order_id: o.id,
        status: o.status,
        created_at: o.created_at,
        payment_method: o.payment_method,
        payment_status: o.payment_status,
        customer: { name: o.customer_name, phone: o.customer_phone, email: o.customer_email },
        delivery_address: { line: o.address_line, pincode: o.address_pincode, phone: o.address_phone },
        shop: { name: o.shop_name, address: o.shop_address, phone: o.shop_phone },
        items: items.map(i => ({
          name: i.name, unit: i.unit, image: i.image,
          quantity: i.quantity, price: Number(i.price),
          line_total: Number(i.line_total), cancelled: i.cancelled,
        })),
        charges: {
          subtotal: Math.round(subtotal * 100) / 100,
          delivery_fee: deliveryFee,
          platform_fee: platformFee,
          discount,
          total,
        },
      }
    })
  } catch (e) {
    console.log("getInvoice error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = getInvoice
