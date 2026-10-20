const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Cookie se user nikalta hai. Mile to { user }, na mile to { error } (kyun nahi mila)
async function findUser(req) {
  const token = req.cookies.token;
  if (!token) return { error: 'Not authenticated' };

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { error: 'Session expired. Please log in again.' };
  }
  if (payload.type !== 'auth') return { error: 'Invalid session' };

  const result = await pool.query(
    'SELECT id, name, email, created_at, token_version FROM users WHERE id = $1',
    [payload.userId]
  );
  if (result.rows.length === 0) return { error: 'User no longer exists' };

  // Token ka version user ke asli version se milna chahiye (password reset ke baad purane token yahin pakde jate hain)
  const { token_version: tokenVersion, ...publicUser } = result.rows[0];
  if ((payload.tv ?? 0) !== tokenVersion) return { error: 'Session expired. Please log in again.' };

  return { user: publicUser };
}

// Protected routes ke liye: login na ho to 401
async function requireAuth(req, res, next) {
  try {
    const { user, error } = await findUser(req);
    if (!user) return res.status(401).json({ error });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Sirf "login hai ya nahi" batata hai. Login na ho to bhi 200 (user: null)
async function getSession(req, res, next) {
  try {
    const { user } = await findUser(req);
    res.json({ user: user || null });
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, getSession };