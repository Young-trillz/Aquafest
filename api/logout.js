// POST /api/logout — invalidate the current staff/admin session.

const { getRedis } = require('./_redis');
const { verifyToken } = require('./auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1].trim() : null;
    const session = await verifyToken(req);
    if (!session || !token) return res.status(401).json({ error: 'Authentication required' });

    const redis = getRedis();
    await redis.del(`auth:${token}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('logout error:', err);
    if (err.code === 'REDIS_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
    return res.status(500).json({ error: 'Logout failed' });
  }
};
