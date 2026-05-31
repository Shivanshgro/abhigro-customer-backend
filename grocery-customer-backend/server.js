require("dotenv").config()
require("./src/config/db")

const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const compression = require("compression")
const http = require("http")
const { Server } = require("socket.io")
const apiLimiter = require("./src/middleware/rateLimiter")

const authRoutes = require("./src/routes/authRoutes")
const productRoutes = require("./src/routes/productRoutes")
const cartRoutes = require("./src/routes/cartRoutes")
const orderRoutes = require("./src/routes/orderRoutes")
const wishlistRoutes = require("./src/routes/wishlistRoutes")
const addressRoutes = require("./src/routes/addressRoutes")
const paymentRoutes = require("./src/routes/paymentRoutes")
const notificationRoutes = require("./src/routes/notificationRoutes")
const couponRoutes = require("./src/routes/couponRoutes")
const deliveryRoutes = require("./src/routes/deliveryRoutes")
const adminRoutes = require("./src/routes/adminRoutes")
const uploadRoutes = require("./src/routes/uploadRoutes")
const searchProducts = require("./src/controllers/product/searchProducts")
const orderSocket = require("./src/socket/orderSocket")

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }
})

orderSocket(io)

// MIDDLEWARE
app.use(cors())
app.use(helmet())
app.use(compression())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(apiLimiter)

// HEALTH
app.get("/", (req, res) => res.json({ success: true, message: "FreshKart Backend Running 🚀" }))
app.get("/health", (req, res) => res.json({ success: true, database: "Connected", server: "Running" }))

// ROUTES
app.use("/api/auth", authRoutes)
app.use("/api/products", productRoutes)
app.use("/api/cart", cartRoutes)
app.use("/api/orders", orderRoutes)
app.use("/api/wishlist", wishlistRoutes)
app.use("/api/address", addressRoutes)
app.use("/api/payment", paymentRoutes)
app.use("/api/notifications", notificationRoutes)
app.use("/api/coupons", couponRoutes)
app.use("/api/delivery", deliveryRoutes)
app.use("/api/delivery-slots", deliveryRoutes)  // FIX: frontend calls /api/delivery-slots
app.use("/api/admin", adminRoutes)
app.use("/api/upload", uploadRoutes)
app.use("/api/profile", require("./src/routes/authRoutes"))   // /api/profile aliases auth profile routes

// /api/search?q= shortcut (frontend SearchResults calls /search?q=)
app.get("/api/search", searchProducts)

const subscriptionRoutes = require("./src/routes/subscriptionRoutes")
const startSubscriptionCron = require("./src/jobs/subscriptionCron")
app.use("/api/subscription", subscriptionRoutes)
startSubscriptionCron()

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route Not Found" })
})

// ERROR
app.use((err, req, res, next) => {
  console.log("SERVER ERROR:", err)
  res.status(500).json({ success: false, message: "Internal Server Error" })
})

const PORT = process.env.PORT || 5000
server.listen(PORT, () => {
  console.log(`FreshKart Backend running on port ${PORT}`)
})
