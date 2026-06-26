const pool = require("../config/db")

// Credit or debit a user's wallet atomically and write a ledger row.
// amount > 0 credits, amount < 0 debits. Returns new balance.
async function walletTxn(client, userId, amount, type, reference = null) {
  const db = client || pool
  const u = await db.query(`SELECT wallet_balance FROM users WHERE id=$1 FOR UPDATE`, [userId])
  const current = Number(u.rows[0]?.wallet_balance || 0)
  const next = current + Number(amount)
  if (next < 0) throw new Error("Insufficient wallet balance")
  await db.query(`UPDATE users SET wallet_balance=$1 WHERE id=$2`, [next, userId])
  await db.query(
    `INSERT INTO wallet_transactions(user_id, amount, type, reference, balance_after)
     VALUES($1,$2,$3,$4,$5)`,
    [userId, amount, type, reference, next]
  )
  return next
}
module.exports = { walletTxn }
