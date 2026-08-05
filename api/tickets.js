// GET /api/tickets
// Admin (or staff) only. Returns every ticket on record for the
// transactions / QR tracking panel.
//
// Response: { tickets: [ { id, name, email, qty, amountPaid, status,
//   purchasedAt, checkedInAt?, reference, qrPayload } ] }

const { kv } = require('@vercel/kv');
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

    const ids = (await kv.smembers('ticket-index')) || [];
    const tickets = [];

    for (const id of ids) {
      const t = await kv.get(`ticket:${id}`);
      if (!t) continue;
      tickets.push({
        id: t.id,
        name: t.name,
        email: t.email,
        qty: t.qty,
        amountPaid: t.amountPaid,
        status: t.status,
        purchasedAt: t.purchasedAt,
        checkedInAt: t.checkedInAt || null,
        reference: t.reference,
        // Same payload encoded into the QR on the wristband / email
        qrPayload: JSON.stringify({ id: t.id, name: t.name })
      });
    }

    // Newest first
    tickets.sort((a, b) => {
      const ta = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
      const tb = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
      return tb - ta;
    });

    return res.status(200).json({ tickets, count: tickets.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not load tickets' });
  }
};
