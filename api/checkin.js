// POST /api/checkin
// Body: { id }  — id can be a plain ticket id, or the raw QR payload
// (a JSON string like {"id":"AQF-ABC123","name":"..."}) — both are accepted.
// Requires staff or admin Bearer token.
//
// Returns:
//   { result: 'invalid' }                        — 404, no such ticket
//   { result: 'already-used', ticket }            — 200, previously checked in
//   { result: 'ok', ticket }                      — 200, checked in just now

const { kv } = require('@vercel/kv');
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
      // rawId was already a plain ticket id string — use as-is
    }

    const ticket = await kv.get(`ticket:${id}`);
    if (!ticket) {
      return res.status(404).json({ result: 'invalid' });
    }

    if (ticket.status === 'checked-in') {
      return res.status(200).json({ result: 'already-used', ticket });
    }

    ticket.status = 'checked-in';
    ticket.checkedInAt = new Date().toISOString();
    await kv.set(`ticket:${id}`, ticket);

    return res.status(200).json({ result: 'ok', ticket });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Check-in failed' });
  }
};
