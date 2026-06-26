const pool = require("../../config/db")
const { getDeliverySettings } = require("../../utils/settings")

// POST /api/wallet/apply-referral  { code }
// Links the current user to a referrer. Referrer bonus is paid on this user's
// FIRST delivered order (handled in markDelivered hook), not immediately.
// The referee (this user) can get an immediate signup-style bonus if configured.
const applyReferral = async (req, res) => {
  try {
    const userId = req.user.id
    const { code } = req.body
    if (!code) return res.status(400).json({ message: "Referral code required" })

    const me = await pool.query(`SELECT referred_by FROM users WHERE id=$1`, [userId])
    if (me.rows[0]?.referred_by) return res.status(400).json({ message: "Referral already applied" })

    const ref = await pool.query(`SELECT id FROM users WHERE referral_code=$1`, [code.toUpperCase()])
    if (ref.rows.length === 0) return res.status(404).json({ message: "Invalid referral code" })
    const referrerId = ref.rows[0].id
    if (String(referrerId) === String(userId)) return res.status(400).json({ message: "Cannot refer yourself" })

    await pool.query(`UPDATE users SET referred_by=$1 WHERE id=$2`, [referrerId, userId])
    res.json({ success: true, message: "Referral applied! Bonus credited after your first delivered order." })
  } catch (e) {
    console.log("applyReferral error:", e.message)
    res.status(500).json({ message: e.message })
  }
}
module.exports = applyReferral
