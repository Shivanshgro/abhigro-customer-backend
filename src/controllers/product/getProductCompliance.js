// src/controllers/product/getProductCompliance.js
// AbhiGro — category-based product compliance sections + publish validation.
// Matches your existing style: const pool = require("../../config/db"); pool.query(...)
// Never fabricates data — only returns what admin has entered.

const pool = require("../../config/db")

// Fetch field rules for a category_id
async function getCategoryRules(categoryId) {
  const { rows } = await pool.query(
    `SELECT field_key, requirement, display_section, display_label, display_order
       FROM category_field_rules
      WHERE category_id = $1
      ORDER BY display_order ASC`,
    [categoryId]
  )
  return rows
}

// Build customer-facing sections for a product row (hides empty; never invents)
function buildSections(product, rules) {
  const details = product.details || {}
  const columnValues = {
    name: product.name,
    price: product.price,
    mrp: product.mrp,
    net_quantity: product.unit, // your column is 'unit'
  }
  const ORDER = ['Highlights','Product Information','Ingredients','Nutrition',
                 'Storage','Manufacturer','Seller','Regulatory','Return/Refund','Disclaimer']
  const map = new Map()
  for (const rule of rules) {
    if (rule.requirement === 'hidden') continue
    const raw = (columnValues[rule.field_key] !== undefined &&
                 columnValues[rule.field_key] !== null &&
                 columnValues[rule.field_key] !== '')
      ? columnValues[rule.field_key]
      : details[rule.field_key]
    const isEmpty = raw === undefined || raw === null || raw === '' ||
      (typeof raw === 'object' && Object.keys(raw).length === 0)
    if (isEmpty) continue
    const section = rule.display_section || 'Product Information'
    if (!map.has(section)) map.set(section, [])
    map.get(section).push({ key: rule.field_key, label: rule.display_label || rule.field_key, value: raw })
  }
  const result = []
  for (const name of ORDER) if (map.has(name)) result.push({ section: name, items: map.get(name) })
  for (const [name, items] of map) if (!ORDER.includes(name)) result.push({ section: name, items })
  return result
}

// GET /api/compliance/product/:id  -> { product, sections }
async function getProductCompliance(req, res) {
  try {
    const { rows } = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: "Product not found" })
    const product = rows[0]
    const rules = await getCategoryRules(product.category_id)
    const sections = buildSections(product, rules)
    res.json({ product, sections })
  } catch (e) {
    console.log("getProductCompliance error:", e.message)
    res.status(500).json({ error: "Failed to load compliance data" })
  }
}

// POST /api/compliance/validate/:id  -> { ok, missing:[] }  (admin publish gate)
async function validateProductForPublish(req, res) {
  try {
    const { rows } = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: "Product not found" })
    const product = rows[0]
    if (!product.category_id) return res.json({ ok: false, missing: ["category_id"] })
    const rules = await getCategoryRules(product.category_id)
    if (rules.length === 0) return res.json({ ok: false, missing: ["__no_rules_for_category__"] })

    const details = product.details || {}
    const columnValues = { name: product.name, price: product.price, mrp: product.mrp, net_quantity: product.unit }
    const missing = []
    for (const rule of rules) {
      if (rule.requirement !== 'required') continue
      const v = (columnValues[rule.field_key] !== undefined && columnValues[rule.field_key] !== null && columnValues[rule.field_key] !== '')
        ? columnValues[rule.field_key] : details[rule.field_key]
      const present = v !== undefined && v !== null && v !== '' &&
        !(typeof v === 'object' && Object.keys(v).length === 0)
      if (!present) missing.push(rule.field_key)
    }
    res.json({ ok: missing.length === 0, missing })
  } catch (e) {
    console.log("validateProductForPublish error:", e.message)
    res.status(500).json({ error: "Validation failed" })
  }
}

module.exports = { getProductCompliance, validateProductForPublish }
