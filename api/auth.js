// POST /api/auth
// Body: { username, password }
// Returns: { token, role, name } on success
//
// Roles: "staff" (gate scanner) | "admin" (prices + transactions + scanner)
// Tokens are stored in Redis with a 12-hour TTL.

const crypto = require('crypto');
const { getRedis } = require('./_redis');

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12 hours
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 8;

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    let redis;
    try {
      redis = getRedis();
    } catch (e) {
      if (e.code === 'REDIS_NOT_CONFIGURED') return res.status(503).json({ error: e.message });
      throw e;
    }

    const normalizedUser = String(username).trim().toLowerCase();
    const attemptKey = `login-attempts:${normalizedUser}`;
    const attempts = Number(await redis.get(attemptKey)) || 0;
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }

    const staffUser = process.env.STAFF_USERNAME || 'staff';
    const staffPass = process.env.STAFF_PASSWORD || '';
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || '';

    if (!staffPass && !adminPass) {
      return res.status(503).json({
        error:
          'Staff/admin passwords are not configured. Set STAFF_PASSWORD and/or ADMIN_PASSWORD in Vercel Environment Variables.'
      });
    }

    let role = null;
    const name = username;

    if (
      timingSafeEqual(username, adminUser) &&
      adminPass &&
      timingSafeEqual(password, adminPass)
    ) {
      role = 'admin';
    } else if (
      timingSafeEqual(username, staffUser) &&
      staffPass &&
      timingSafeEqual(password, staffPass)
    ) {
      role = 'staff';
    }

    if (!role) {
      const nextAttempts = attempts + 1;
      await redis.set(attemptKey, nextAttempts, { ex: LOGIN_WINDOW_SECONDS });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await redis.del(attemptKey);

    
    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      username: name,
      role,
      createdAt: new Date().toISOString(),
      exp: Date.now() + TOKEN_TTL_SECONDS * 1000
    };

    await redis.set(`auth:${token}`, session, { ex: TOKEN_TTL_SECONDS });

    return res.status(200).json({ token, role, name });
  } catch (err) {
    console.error('auth error:', err);
    return res.status(500).json({
      error: err.message || 'Login failed',
      detail: process.env.NODE_ENV === 'development' ? String(err.stack || err) : undefined
    });
  }
};

/** Shared helper — verify Bearer token. Returns session or null. */
async function verifyToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    return null;
  }

  const session = await redis.get(`auth:${token}`);
  if (!session) return null;
  // Upstash may already parse JSON objects
  const s = typeof session === 'string' ? JSON.parse(session) : session;
  if (s.exp && Date.now() > s.exp) {
    await redis.del(`auth:${token}`);
    return null;
  }
  return s;
}

module.exports.verifyToken = verifyToken;
