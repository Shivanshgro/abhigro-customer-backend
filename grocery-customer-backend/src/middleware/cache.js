// ── Simple In-Memory Cache ────────────────────────────────────────────────────
// Caches product catalog for 5 minutes
// At 10K users hitting /products — DB gets hit ONCE every 5 min not 10K times
// ─────────────────────────────────────────────────────────────────────────────
const store = new Map()

function cache(ttlSeconds = 300) {
  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next()

    const key = req.originalUrl

    if (store.has(key)) {
      const { data, expires } = store.get(key)
      if (Date.now() < expires) {
        res.setHeader('X-Cache', 'HIT')
        return res.json(data)
      }
      store.delete(key)
    }

    // Override res.json to cache the response
    const originalJson = res.json.bind(res)
    res.json = (data) => {
      if (res.statusCode === 200) {
        store.set(key, { data, expires: Date.now() + ttlSeconds * 1000 })
      }
      res.setHeader('X-Cache', 'MISS')
      return originalJson(data)
    }

    next()
  }
}

// Clear cache for a specific prefix (call after product update)
function clearCache(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

module.exports = { cache, clearCache }
