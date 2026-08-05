// Shared Redis client for all API routes.
// Uses @upstash/redis (Vercel KV is deprecated / EOL).
//
// Env vars (any of these pairs work):
//   UPSTASH_REDIS_REST_URL  + UPSTASH_REDIS_REST_TOKEN   ← Upstash / Marketplace
//   KV_REST_API_URL         + KV_REST_API_TOKEN          ← legacy Vercel KV rename

const { Redis } = require('@upstash/redis');

let _client = null;

function getRedis() {
  if (_client) return _client;

  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    '';
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    '';

  if (!url || !token) {
    const err = new Error(
      'Redis is not configured. Connect Upstash Redis in the Vercel dashboard ' +
        '(Storage / Integrations → Upstash Redis), or set UPSTASH_REDIS_REST_URL ' +
        'and UPSTASH_REDIS_REST_TOKEN in Environment Variables.'
    );
    err.code = 'REDIS_NOT_CONFIGURED';
    throw err;
  }

  _client = new Redis({ url, token });
  return _client;
}

module.exports = { getRedis };
