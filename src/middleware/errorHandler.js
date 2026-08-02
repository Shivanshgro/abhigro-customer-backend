// Central error handler — logs full detail server-side, returns generic message to client.
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500
  // full detail stays in server logs only
  console.error(`[ERR ${new Date().toISOString()}] ${req.method} ${req.originalUrl} ->`, err.stack || err.message || err)
  // Multer-specific friendly messages (safe to show)
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ success: false, message: "File too large. Max 5 MB." })
  if (err.message && /Only .* allowed/.test(err.message)) return res.status(415).json({ success: false, message: err.message })
  // otherwise generic
  res.status(status).json({
    success: false,
    message: status < 500 ? (err.publicMessage || err.message || "Request could not be processed")
                          : "Something went wrong. Please try again.",
  })
}
module.exports = errorHandler
