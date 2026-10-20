const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// backend/uploads/ : movies yahin save hoti hain
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SIZE_MB = Number(process.env.MAX_VIDEO_SIZE_MB) || 2048;

// MIME type hum khud extension se decide karte hain (client ka bheja hua bharosemand nahi)
const ALLOWED_TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // User ka diya naam kabhi disk par use nahi karte, random naam rakhte hain
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeOk =
    !file.mimetype || file.mimetype.startsWith('video/') || file.mimetype === 'application/octet-stream';

  if (!ALLOWED_TYPES[ext] || !mimeOk) {
    const err = new Error('Only MP4, MKV and WebM files are allowed.');
    err.code = 'UNSUPPORTED_FILE_TYPE';
    return cb(err);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024, files: 1 },
});

// Multer ke errors ko saaf JSON message mein badalta hai
function handleVideoUpload(req, res, next) {
  upload.single('video')(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File is too large. Maximum size is ${MAX_SIZE_MB} MB.` });
    }
    if (err.code === 'UNSUPPORTED_FILE_TYPE') {
      return res.status(415).json({ error: err.message });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: 'Upload failed. Please choose the file again.' });
    }
    next(err);
  });
}

// File ke andar ke shuruaati bytes dekhkar pakka karo ki wo sach mein video hai
// (koi .txt ka naam badal kar .mp4 kar de to yahan pakda jayega)
async function hasValidSignature(filePath, ext) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(12);
    await handle.read(buf, 0, 12, 0);

    if (ext === '.mp4') {
      return buf.subarray(4, 8).toString('ascii') === 'ftyp';
    }
    // WebM aur MKV dono EBML header (1A 45 DF A3) se shuru hote hain
    return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  } finally {
    await handle.close();
  }
}

module.exports = { UPLOAD_DIR, ALLOWED_TYPES, handleVideoUpload, hasValidSignature };