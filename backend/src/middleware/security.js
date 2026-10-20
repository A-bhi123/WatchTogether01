const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Sirf hamari frontend site (trailing slash ke bina)
function allowedOrigin() {
  return (process.env.FRONTEND_URL || '').replace(/\/$/, '');
}

// CSRF se bachav: browser doosri site se POST/PUT/DELETE bheje to usme "Origin" header hamesha hota hai.
// Wo hamari site ka na ho to rok do. (curl jaise tools mein cookie hoti hi nahi, isliye unhe khatra nahi)
function requireTrustedOrigin(req, res, next) {
  if (SAFE_METHODS.includes(req.method)) return next();

  const origin = req.headers.origin;
  if (origin && origin !== allowedOrigin()) {
    return res.status(403).json({ error: 'Request blocked: untrusted origin.' });
  }
  next();
}

module.exports = { requireTrustedOrigin, allowedOrigin };