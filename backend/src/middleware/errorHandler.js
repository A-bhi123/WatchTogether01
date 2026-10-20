// Postgres tak pahunch hi nahi paye (band hai, restart ho raha hai, connection toota)
const DB_DOWN_CODES = [
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE',
  '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006', '53300',
];

function isDatabaseDown(err) {
  const codes = [err?.code, ...(err?.errors || []).map((e) => e.code)];
  return (
    codes.some((code) => DB_DOWN_CODES.includes(code)) ||
    /Connection terminated|timeout exceeded when trying to connect/i.test(err?.message || '')
  );
}

function errorHandler(err, req, res, next) {
  // Jawab aadha ja chuka ho to Express ko sambhalne do
  if (res.headersSent) return next(err);

  // Poora error sirf server ke log mein. Client ko kabhi nahi
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);

  // express.json(): toota hua JSON ya bahut bada body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid request data.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The request is too large.' });
  }

  // Jo errors hamne khud "user ko dikhane layak" mark kiye hain (jaise email nahi gayi)
  if (err.expose) {
    return res.status(err.status || 500).json({ error: err.message });
  }

  // Database tak pahunch nahi paye: 503 = "abhi service nahi hai, thodi der baad try karo"
  if (isDatabaseDown(err)) {
    return res.status(503).json({
      error: 'The service is temporarily unavailable. Please try again in a moment.',
      code: 'DB_UNAVAILABLE',
    });
  }

  // Baaki sab (SQL error, code ka bug): andar ki baat client ko nahi bhejte
  res.status(500).json({ error: 'Something went wrong on our side. Please try again in a moment.' });
}

module.exports = errorHandler;