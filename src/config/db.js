const { Pool } = require('pg')
require('dotenv').config()

// ── Connection Pool ───────────────────────────────────────────────────────────
// Handles 10K+ concurrent users safely
// Max 20 connections shared across all requests (vs 1 per request = crash)
// ─────────────────────────────────────────────────────────────────────────────
const pool = new Pool({
  host:                process.env.DB_HOST,
  port:                Number(process.env.DB_PORT) || 5432,
  database:            process.env.DB_NAME,
  user:                process.env.DB_USER,
  password:            process.env.DB_PASSWORD,
  ssl:                 { rejectUnauthorized: false },

  // Connection pool settings
  max:                 20,    // max 20 connections open at once
  min:                 2,     // keep 2 connections always ready
  idleTimeoutMillis:   30000, // close idle connections after 30s
  connectionTimeoutMillis: 5000, // fail fast if DB unreachable after 5s
  allowExitOnIdle:     false,
})

// Log pool errors (don't crash server)
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message)
})

pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL Connected — pool ready')
    client.release()
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message)
  })

module.exports = pool
