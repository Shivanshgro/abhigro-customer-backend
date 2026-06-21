const { checkEligibility } = require("../../services/roleEligibility")

// POST /api/auth/check-role  { mobile, role }
// Pre-OTP check: is this number registered under the selected role and approved?
const checkRole = async (req, res) => {
  try {
    const { mobile, role } = req.body || {}
    const elig = await checkEligibility(mobile, role || "customer")
    if (!elig.ok) {
      return res.status(elig.code === "pending" ? 403 : 404).json({
        ok: false, message: elig.message,
        notRegistered: elig.code === "not_registered" || elig.code === "wrong_role",
        pending: elig.code === "pending",
      })
    }
    res.json({ ok: true })
  } catch (e) {
    console.log("checkRole error:", e.message)
    res.status(500).json({ ok: false, message: "Could not verify. Try again." })
  }
}

module.exports = checkRole