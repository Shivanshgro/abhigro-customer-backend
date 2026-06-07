const pool = require("../../config/db")
const jwt = require("jsonwebtoken")
const axios = require("axios")

const JWT_SECRET = process.env.JWT_SECRET || "grocery_secret"
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY

const mobileLogin = async (req, res) => {
  try {
    const { mobile, token } = req.body

    if (!mobile || !token) {
      return res.status(400).json({ message: "Mobile and token are required" })
    }

    // Verify OTP token with MSG91
    const verifyRes = await axios.post(
      "https://control.msg91.com/api/v5/widget/verifyAccessToken",
      {
        authkey: MSG91_AUTH_KEY,
        "access-token": token
      },
      { headers: { "Content-Type": "application/json" } }
    )

    if (!verifyRes.data || verifyRes.data.type !== "success") {
      return res.status(401).json({ message: "Invalid OTP. Please try again." })
    }

    // Check if user exists with this mobile
    let user = await pool.query(
      `SELECT * FROM users WHERE phone = $1`,
      [mobile]
    )

    if (user.rows.length === 0) {
      // Auto-register new user with mobile
      const newUser = await pool.query(
        `INSERT INTO users(name, phone, role) VALUES($1,$2,'customer') RETURNING *`,
        [`User${mobile.slice(-4)}`, mobile]
      )
      user = { rows: [newUser.rows[0]] }
    }

    const userData = user.rows[0]

    // Generate JWT tokens
    const accessToken = jwt.sign(
      { id: userData.id, phone: userData.phone, role: userData.role || "customer" },
      JWT_SECRET,
      { expiresIn: "7d" }
    )

    const refreshToken = jwt.sign(
      { id: userData.id },
      JWT_SECRET,
      { expiresIn: "30d" }
    )

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        phone: userData.phone,
        role: userData.role || "customer"
      }
    })
  } catch (error) {
    console.log("Mobile login error:", error.message)
    res.status(500).json({ message: "Login failed. Please try again." })
  }
}

module.exports = mobileLogin