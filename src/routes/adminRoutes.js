const express      = require("express")
const router       = express.Router()
const auth         = require("../middleware/authMiddleware")
const admin        = require("../middleware/adminMiddleware")
const dashboardStats = require("../controllers/admin/dashboardStats")
const addProduct   = require("../controllers/admin/addProduct")
const { editProduct, toggleProduct, setAvailability } = require("../controllers/admin/editProduct")
const bulkImportProducts = require("../controllers/admin/bulkImportProducts")
const clearProducts = require("../controllers/admin/clearProducts")
const updateProduct = require("../controllers/admin/updateProduct")
const deleteProduct = require("../controllers/admin/deleteProduct")
const pool         = require("../config/db")

// Dashboard
router.get("/dashboard", auth, admin, dashboardStats)

// ── Orders (for Admin dashboard) ──────────────────────────────────
const adminOrders = require("../controllers/admin/adminOrders")
router.get("/orders", auth, admin, adminOrders.listOrders)
router.get("/orders/:id", auth, admin, adminOrders.getOrder)

// ── Product Management ────────────────────────────────────────────
// Get all products (including inactive)
router.get("/products", auth, admin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.id DESC`
    )
    res.json({ success: true, products: result.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
})

router.post("/products",        auth, admin, addProduct)
router.put("/products/:id",          auth, admin, editProduct)
router.put("/products/:id/toggle",   auth, admin, toggleProduct)
router.put("/products/:id/availability", auth, admin, setAvailability)
router.post("/products/bulk-import", auth, admin, bulkImportProducts)
router.post("/products/clear",       auth, admin, clearProducts)
router.put("/products/:id",     auth, admin, updateProduct)
router.delete("/products/:id",  auth, admin, deleteProduct)

// ── Manual stock sync trigger ─────────────────────────────────────
router.post("/sync-stock", auth, admin, async (req, res) => {
  try {
    const { runStockSync } = require("../jobs/stockSyncJob")
    await runStockSync()
    res.json({ success: true, message: "Stock sync completed" })
  } catch (e) { res.status(500).json({ message: e.message }) }
})

// ── Get all suppliers ─────────────────────────────────────────────
router.get("/suppliers", auth, admin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, is_active, created_at FROM suppliers ORDER BY id DESC`
    )
    res.json({ success: true, suppliers: result.rows })
  } catch (e) { res.status(500).json({ message: e.message }) }
})

module.exports = router
