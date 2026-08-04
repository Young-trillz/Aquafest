// GET /api/stats
// Returns aggregate numbers for the gate-staff dashboard.

const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  try {
    const ids = (await kv.smembers('ticket-index')) || [];
    let sold = 0;
    let checkedIn = 0;
    let revenue = 0;

    for (const id of ids) {
      const t = await kv.get(`ticket:${id}`);
      if (!t) continue;
      sold += Number(t.qty) || 0;
      revenue += Number(t.amountPaid) || 0;
      if (t.status === 'checked-in') checkedIn++;
    }

    return res.status(200).json({ sold, checkedIn, revenue });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not load stats' });
  }
};
