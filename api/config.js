// GET  /api/config          — public: current event prices & date
// POST /api/config          — admin only: update earlyPrice, doorPrice, eventDateISO
//
// Prices live in Vercel KV under key "config:event" so the admin panel
// can change them without redeploying. Falls back to sensible defaults
// if nothing has been saved yet.

const { kv } = require('@vercel/kv');
const { verifyToken } = require('./auth');

const DEFAULTS = {
  eventDateISO: '2026-11-30T14:00:00',
  earlyPrice: 5000,
  doorPrice: 8000,
  currencySymbol: '₦'
};

async function loadConfig() {
  const stored = await kv.get('config:event');
  return { ...DEFAULTS, ...(stored || {}) };
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const config = await loadConfig();
      return res.status(200).json(config);
    }

    if (req.method === 'POST') {
      const session = await verifyToken(req);
      if (!session || session.role !== 'admin') {
        return res.status(401).json({ error: 'Admin authentication required' });
      }

      const body = req.body || {};
      const current = await loadConfig();

      const next = { ...current };

      if (body.earlyPrice !== undefined) {
        const n = Number(body.earlyPrice);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ error: 'earlyPrice must be a non-negative number' });
        }
        next.earlyPrice = Math.round(n);
      }
      if (body.doorPrice !== undefined) {
        const n = Number(body.doorPrice);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ error: 'doorPrice must be a non-negative number' });
        }
        next.doorPrice = Math.round(n);
      }
      if (body.eventDateISO !== undefined) {
        const d = new Date(body.eventDateISO);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ error: 'eventDateISO must be a valid ISO date string' });
        }
        next.eventDateISO = body.eventDateISO;
      }
      if (body.currencySymbol !== undefined && typeof body.currencySymbol === 'string') {
        next.currencySymbol = body.currencySymbol.slice(0, 4);
      }

      await kv.set('config:event', next);
      return res.status(200).json(next);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not load or save config' });
  }
};

module.exports.loadConfig = loadConfig;
