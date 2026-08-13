// GET /api/export-data — admin-only JSON backup of AquaFest operational data.
const { getRedis } = require('./_redis');
const { verifyToken } = require('./auth');
const { loadConfig } = require('./config');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await verifyToken(req);
    if (!session || session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const redis = getRedis();
    const ids = (await redis.smembers('ticket-index')) || [];
    const tickets = [];

    for (const id of ids) {
      const raw = await redis.get(`ticket:${id}`);
      if (!raw) continue;
      const ticket = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const marker = await redis.get(`checkin:${id}`);
      let checkin = null;
      if (marker) {
        try { checkin = typeof marker === 'string' ? JSON.parse(marker) : marker; } catch (e) {}
      }
      tickets.push({ ticket, checkin });
    }

    const payload = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: session.username,
      config: await loadConfig(),
      ticketCount: tickets.length,
      tickets
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="aquafest-backup-${new Date().toISOString().slice(0,10)}.json"`);
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('export-data failed:', err);
    if (err.code === 'REDIS_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
    return res.status(500).json({ error: 'Could not create backup export' });
  }
};
