// GET /api/tickets — full transaction + QR list (auth required)

const { getRedis } = require('./_redis');
const { verifyToken } = require('./auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const session = await verifyToken(req);
    if (!session || (session.role !== 'admin' && session.role !== 'staff')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const redis = getRedis();
    const ids = (await redis.smembers('ticket-index')) || [];
    const tickets = [];

    for (const id of ids) {
      const raw = await redis.get(`ticket:${id}`);
      if (!raw) continue;
      const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
      tickets.push({
        id: t.id,
        name: t.name,
        email: t.email,
        qty: 1,
        ticketNumber: t.ticketNumber || 1,
        ticketCount: t.ticketCount || t.qty || 1,
        purchaseId: t.purchaseId || t.id,
        amountPaid: t.amountPaid,
        status: t.status,
        purchasedAt: t.purchasedAt,
        checkedInAt: t.checkedInAt || null,
        reference: t.reference,
        qrPayload: JSON.stringify({ id: t.id, name: t.name })
      });
    }

    tickets.sort((a, b) => {
      const ta = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
      const tb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
      return tb - ta;
    });

    return res.status(200).json({ tickets, count: tickets.length });
  } catch (err) {
    console.error(err);
    if (err.code === 'REDIS_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Could not load tickets' });
  }
};
