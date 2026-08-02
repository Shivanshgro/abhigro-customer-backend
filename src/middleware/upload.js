const multer = require("multer")

const MAX_MB = Number(process.env.UPLOAD_MAX_MB) || 5
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]

// Memory storage (files go straight to Cloudinary, never written to web root / never executable)
const storage = multer.memoryStorage()

function fileFilter(req, file, cb) {
  if (!ALLOWED.includes(file.mimetype)) {
    return cb(new Error("Only JPG, PNG, WEBP images or PDF files are allowed"))
  }
  cb(null, true)
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
})

module.exports = upload
