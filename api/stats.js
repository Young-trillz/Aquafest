// GET /api/stats — sold / checked-in / revenue (auth required)

const { getRedis } = require('./_redis');
const { verifyToken } = require('./auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await verifyToken(req);
    if (!session || (session.role !== 'staff' && session.role !== 'admin')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const redis = getRedis();
    const ids = (await redis.smembers('ticket-index')) || [];
    let sold = 0;
    let checkedIn = 0;
    let revenue = 0;

    for (const id of ids) {
      const raw = await redis.get(`ticket:${id}`);
      if (!raw) continue;
      const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
      sold += 1;
      revenue += Number(t.amountPaid) || 0;
      if (t.status === 'checked-in') checkedIn++;
    }

    const remaining = Math.max(0, sold - checkedIn);
    const checkInRate = sold > 0 ? Number(((checkedIn / sold) * 100).toFixed(1)) : 0;

    return res.status(200).json({ sold, checkedIn, remaining, checkInRate, revenue });
  } catch (err) {
    console.error(err);
    if (err.code === 'REDIS_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Could not load stats' });
  }
};
