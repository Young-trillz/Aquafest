// POST /api/checkin
// Body: { id } — plain ticket id or raw QR JSON payload
// Requires staff or admin Bearer token.
// Check-in is atomic: the same ticket can only be admitted once.

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
    const ticketKey = `ticket:${id}`;
    const ticket = await redis.get(ticketKey);
    if (!ticket) {
      return res.status(404).json({ result: 'invalid' });
    }

    const t = typeof ticket === 'string' ? JSON.parse(ticket) : ticket;

    if (t.status === 'cancelled' || t.status === 'refunded') {
      return res.status(200).json({
        result: 'invalid',
        ticket: t,
        message: `Ticket is ${t.status} and cannot be admitted`
      });
    }

    // Atomic admission gate. SET NX succeeds for exactly one scanner.
    const checkinKey = `checkin:${id}`;
    const checkedInAt = new Date().toISOString();
    const marker = JSON.stringify({ checkedInAt, username: session.username, role: session.role });
    const claimed = await redis.set(checkinKey, marker, { nx: true });

    if (!claimed) {
      const existingMarker = await redis.get(checkinKey);
      let existing = {};
      try {
        existing = typeof existingMarker === 'string' ? JSON.parse(existingMarker) : (existingMarker || {});
      } catch (e) {}

      return res.status(200).json({
        result: 'already-used',
        ticket: {
          ...t,
          status: 'checked-in',
          checkedInAt: existing.checkedInAt || t.checkedInAt || null,
          checkedInBy: existing.username || t.checkedInBy || null
        }
      });
    }

    t.status = 'checked-in';
    t.checkedInAt = checkedInAt;
    t.checkedInBy = session.username;
    await redis.set(ticketKey, t);

    return res.status(200).json({ result: 'ok', ticket: t });
  } catch (err) {
    console.error(err);
    if (err.code === 'REDIS_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Check-in failed' });
  }
};
