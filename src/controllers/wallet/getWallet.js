const pool = require("../../config/db")

// GET /api/wallet  -> balance + recent transactions + referral code
const getWallet = async (req, res) => {
  try {
    const userId = req.user.id
    const u = await pool.query(`SELECT wallet_balance, referral_code FROM users WHERE id=$1`, [userId])
    const txns = await pool.query(
      `SELECT amount, type, reference, balance_after, created_at
       FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [userId]
    )
    res.json({
      balance: Number(u.rows[0]?.wallet_balance || 0),
      referral_code: u.rows[0]?.referral_code || null,
      transactions: txns.rows,
    })
  } catch (e) {
    console.log("getWallet error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = getWallet
