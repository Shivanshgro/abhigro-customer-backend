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
const serviceRoutes = require("./src/routes/serviceRoutes")
const groupBuyRoutes = require("./src/routes/groupBuyRoutes")
const vendorRoutes = require("./src/routes/vendorRoutes")
const deliveryBoyRoutes = require("./src/routes/deliveryBoyRoutes")
const supplierRoutes = require("./src/routes/supplierRoutes")
const uploadRoutes = require("./src/routes/uploadRoutes")
const searchProducts = require("./src/controllers/product/searchProducts")
const orderSocket = require("./src/socket/orderSocket")

const app = express()

// CORS — must be very first middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*")
  res.header("Access-Control-Allow-Credentials", "true")
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS")
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Requested-With")
  if (req.method === "OPTIONS") return res.sendStatus(200)
  next()
})

app.use(cors({ origin: "*", credentials: true }))

const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }
})

orderSocket(io)

// Make io available to controllers (delivery/vendor live updates)
const { setIO } = require("./src/socket/emit")
setIO(io)

// Ensure new delivery/payment columns exist (idempotent, non-destructive)
const ensureSchema = require("./src/config/ensureSchema")
ensureSchema()

// Ensure medicine module tables exist (idempotent, separate from grocery)
const ensureMedicineSchema = require("./src/config/medicineSchema")
ensureMedicineSchema()

// Ensure vendor + delivery partner onboarding tables/columns exist
const ensurePartnerSchema = require("./src/config/partnerSchema")
ensurePartnerSchema()

// MIDDLEWARE
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }))
app.use(compression())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(apiLimiter)

// HEALTH
app.get("/", (req, res) => res.json({ success: true, message: "AbhiGro Backend Running 🚀" }))
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
app.use("/api/delivery-slots", deliveryRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/service", serviceRoutes)
app.use("/api/group-buy", groupBuyRoutes)
app.use("/api/vendor", vendorRoutes)
// ── Medicine module (separate from grocery) — specific mount first ─
app.use("/api/delivery/medicine-orders", require("./src/routes/medicineDeliveryRoutes"))
app.use("/api/delivery", deliveryBoyRoutes)
app.use("/api/medicine", require("./src/routes/medicineRoutes"))
app.use("/api/pharmacy", require("./src/routes/pharmacyRoutes"))
app.use("/api/admin", require("./src/routes/adminMedicineRoutes"))
// Public partner self-registration (vendor + delivery)
app.use("/api/register", require("./src/routes/partnerRoutes"))
app.use("/api/supplier", supplierRoutes)
app.use("/api/upload", uploadRoutes)
// NOTE: profile endpoints are served at /api/auth/profile — no duplicate mount needed
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
  console.log(`AbhiGro Backend running on port ${PORT}`)
})
// Start hourly stock sync job
require("./src/jobs/stockSyncJob")
require("./src/jobs/dailyResetJob")