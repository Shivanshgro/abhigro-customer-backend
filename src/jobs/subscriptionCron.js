const cron = require("node-cron")
const pool = require("../config/db")

async function sendNotification(userId, title, message) {
  try {
    await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${process.env.ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify({
        app_id: process.env.ONESIGNAL_APP_ID,
        filters: [{ field: "tag", key: "user_id", relation: "=", value: String(userId) }],
        headings: { en: title },
        contents: { en: message },
        url: "/subscription"
      })
    })
  } catch (e) { console.log("Notification error:", e.message) }
}

function startSubscriptionCron() {
  // 9 PM reminder
  cron.schedule("0 21 * * *", async () => {
    try {
      const subs = await pool.query(`SELECT user_id FROM subscriptions WHERE active=true AND end_date > NOW()`)
      for (const sub of subs.rows) {
        const today = new Date(); today.setHours(0,0,0,0)
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
        const paid = await pool.query(
          `SELECT id FROM orders WHERE user_id=$1 AND status='Confirmed' AND created_at >= $2 AND created_at < $3`,
          [sub.user_id, today, tomorrow]
        )
        if (paid.rows.length === 0) {
          await sendNotification(sub.user_id, "⏰ Pay Before 10 PM!", "Don't miss tomorrow's morning delivery! Pay for milk, curd, eggs & bread now. Deadline: 10 PM 🌙")
        }
      }
    } catch (error) { console.log("Reminder cron error:", error.message) }
  })

  // 10 PM cancel unpaid
  cron.schedule("0 22 * * *", async () => {
    try {
      const today = new Date(); today.setHours(0,0,0,0)
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
      const cancelled = await pool.query(
        `UPDATE orders SET status='Cancelled' WHERE status='Pending' AND subscription_id IS NOT NULL
         AND created_at >= $1 AND created_at < $2 RETURNING user_id`,
        [today, tomorrow]
      )
      for (const order of cancelled.rows) {
        await sendNotification(order.user_id, "❌ Order Cancelled", "Payment not received before 10 PM. Place your order before 10 PM tomorrow!")
      }
    } catch (error) { console.log("Cancel cron error:", error.message) }
  })

  console.log("Subscription cron jobs scheduled!")
}

module.exports = startSubscriptionCron