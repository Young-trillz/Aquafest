// POST /api/checkin
// Body: { id } — plain ticket id or raw QR JSON payload
// Requires staff or admin Bearer token.

const { getRedis } = require('./_redis');
const { verifyToken } = require('./auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await verifyToken(req);
    if (!session || (session.role !== 'staff' && session.role !== 'admin')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id: rawId } = req.body || {};
    if (!rawId) {
      return res.status(400).json({ error: 'Missing ticket id' });
    }

    let id = rawId;
    try {
      const parsed = JSON.parse(rawId);
      if (parsed && parsed.id) id = parsed.id;
    } catch (e) {
      // already a plain id
    }

    const redis = getRedis();
    const ticket = await redis.get(`ticket:${id}`);
    if (!ticket) {
      return res.status(404).json({ result: 'invalid' });
    }

    const t = typeof ticket === 'string' ? JSON.parse(ticket) : ticket;

    if (t.status === 'checked-in') {
      return res.status(200).json({ result: 'already-used', ticket: t });
    }

    t.status = 'checked-in';
    t.checkedInAt = new Date().toISOString();
    await redis.set(`ticket:${id}`, t);

    return res.status(200).json({ result: 'ok', ticket: t });
  } catch (err) {
    console.error(err);
    if (err.code === 'REDIS_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Check-in failed' });
  }
};
