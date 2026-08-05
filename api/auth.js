// POST /api/auth
// Body: { username, password }
// Returns: { token, role, name } on success
//
// Roles: "staff" (gate scanner) | "admin" (prices + transactions + scanner)
// Tokens are stored in KV with a 12-hour TTL.

const { kv } = require('@vercel/kv');
const crypto = require('crypto');

const TOKEN_TTL_SECONDS = 12 * 60 * 60; // 12 hours

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

    const staffUser = process.env.STAFF_USERNAME || 'staff';
    const staffPass = process.env.STAFF_PASSWORD || '';
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || '';

    let role = null;
    let name = username;

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
      // Avoid leaking whether user or password was wrong
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!staffPass && !adminPass) {
      return res.status(503).json({
        error: 'Staff/admin passwords are not configured on the server'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const session = {
      username: name,
      role,
      createdAt: new Date().toISOString(),
      exp: Date.now() + TOKEN_TTL_SECONDS * 1000
    };

    await kv.set(`auth:${token}`, session, { ex: TOKEN_TTL_SECONDS });

    return res.status(200).json({ token, role, name });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Login failed' });
  }
};

/** Shared helper — verify Bearer token. Returns session or null. */
async function verifyToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  const session = await kv.get(`auth:${token}`);
  if (!session) return null;
  if (session.exp && Date.now() > session.exp) {
    await kv.del(`auth:${token}`);
    return null;
  }
  return session;
}

module.exports.verifyToken = verifyToken;
