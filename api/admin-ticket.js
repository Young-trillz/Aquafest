// POST /api/admin-ticket
// Admin-only ticket lifecycle management.
// Body: { id, action: "cancel" | "refund" }

const { getRedis } = require('./_redis');
const { verifyToken } = require('./auth');

const ALLOWED = new Set(['cancel', 'refund']);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await verifyToken(req);
    if (!session || session.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { id, action } = req.body || {};
    if (!id || !ALLOWED.has(action)) {
      return res.status(400).json({ error: 'Ticket id and valid action are required' });
    }

    const redis = getRedis();
    const key = `ticket:${id}`;
    const raw = await redis.get(key);
    if (!raw) return res.status(404).json({ error: 'Ticket not found' });

    const ticket = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (ticket.status === 'checked-in') {
      return res.status(409).json({ error: 'A checked-in ticket cannot be cancelled or refunded' });
    }
    if (ticket.status === 'cancelled' && action === 'cancel') {
      return res.status(200).json({ ticket });
    }
    if (ticket.status === 'refunded' && action === 'refund') {
      return res.status(200).json({ ticket });
    }

    ticket.status = action === 'cancel' ? 'cancelled' : 'refunded';
    ticket.lifecycleAction = action;
    ticket.lifecycleAt = new Date().toISOString();
    ticket.lifecycleBy = session.username;

    // Remove any existing admission marker so lifecycle status is authoritative.
    await redis.del(`checkin:${id}`);
    await redis.set(key, ticket);

    return res.status(200).json({ ticket });
  } catch (err) {
    console.error('admin-ticket error:', err);
    if (err.code === 'REDIS_NOT_CONFIGURED') return res.status(503).json({ error: err.message });
    return res.status(500).json({ error: 'Could not update ticket' });
  }
};
