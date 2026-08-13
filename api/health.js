// GET /api/health — authenticated operational health check.
const { getRedis } = require('./_redis');
const { verifyToken } = require('./auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const started = Date.now();
  try {
    const session = await verifyToken(req);
    if (!session || (session.role !== 'staff' && session.role !== 'admin')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const redis = getRedis();
    await redis.get('health:ping');
    const redisMs = Date.now() - started;

    return res.status(200).json({
      ok: true,
      service: 'aquafest',
      redis: { ok: true, latencyMs: redisMs },
      checkedAt: new Date().toISOString(),
      integrations: {
        paystackConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY),
        resendConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
      }
    });
  } catch (err) {
    console.error('health check failed:', err);
    return res.status(503).json({
      ok: false,
      service: 'aquafest',
      checkedAt: new Date().toISOString(),
      error: err.code === 'REDIS_NOT_CONFIGURED' ? 'Redis is not configured' : 'Operational dependency unavailable'
    });
  }
};
