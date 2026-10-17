import express from 'express';
import { validateReset } from './baseline.js';
import { resetDatabase } from './database.js';
import { createTokenService, context } from './auth.js';
import { findTarget, permits } from './policy.js';
import { rateLimit } from './rate-limit.js';

const errorBody = (code, message, details = {}) => ({error: {code, message, details}});
export function createApp(pool, redis, tokens = createTokenService()) {
  const app = express();
  app.disable('x-powered-by');
  const json = express.json({limit: '1mb', strict: false, type: () => true});
  const probe = (method, path, action, kind) => app[method](path, async (req, res, next) => {
    const user = tokens.verify(req.headers.authorization);
    if (!user) return res.status(401).json(errorBody('UNAUTHENTICATED', 'Valid bearer token required'));
    try {
      const target = kind ? await findTarget(pool, kind, req.params.id) : null;
      if (kind && !target) return res.status(404).json(errorBody(`${kind.toUpperCase()}_NOT_FOUND`, 'Referenced id does not exist'));
      if (!permits(user, action, target)) return res.status(403).json(errorBody('FORBIDDEN', 'Access denied'));
      next();
    } catch (error) { next(error); }
  }, json, (_req, res) => res.json({authorized: true}));
  probe('post', '/audit/v1/rbac/tenants', 'tenants');
  probe('post', '/audit/v1/rbac/leagues/:id/fixtures', 'fixtures', 'league');
  probe('post', '/audit/v1/rbac/clubs/:id/roster', 'roster', 'club');
  probe('post', '/audit/v1/rbac/clubs/:id/products', 'products', 'club');
  probe('patch', '/audit/v1/rbac/players/:id', 'player', 'player');
  probe('get', '/audit/v1/rbac/clubs/:id', 'club', 'club');
  probe('get', '/audit/v1/rbac/platform/config', 'config');
  app.use('/api/v1', rateLimit(redis));
  app.use(json);
  app.post('/audit/v1/rbac-matrix', async (_req, res, next) => {
    try {
      const users = (await pool.query('SELECT user_id, role, tenant_id, league_id, club_id, player_id FROM users ORDER BY user_id')).rows;
      res.json({tokens: Object.fromEntries(users.map(({user_id, ...claims}) => [claims.role, tokens.issue({sub: user_id, ...claims})])), context});
    } catch (error) { next(error); }
  });
  app.get('/api/v1/ping', (_req, res) => res.json({pong: true}));
  app.get('/health', async (_req, res) => {
    try {
      const result = await pool.query("SELECT value FROM app_state WHERE key = 'baseline_seeded'");
      await redis.ping();
      if (result.rows[0]?.value !== true) throw new Error('Baseline not ready');
      res.json({status: 'ok'});
    } catch { res.status(503).json(errorBody('NOT_READY', 'Dependencies or baseline are not ready')); }
  });
  app.post('/audit/v1/reset', async (req, res, next) => {
    const body = req.body === undefined ? {} : req.body;
    const fields = validateReset(body);
    if (fields.length) return res.status(400).json(errorBody('VALIDATION_ERROR', 'Invalid reset parameters', {fields}));
    try { res.json(await resetDatabase(pool, redis, body)); } catch (error) { next(error); }
  });
  app.use((_req, res) => res.status(404).json(errorBody('NOT_FOUND', 'Route not found')));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') return res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Body exceeds 1 MB'));
    if (error.type === 'entity.parse.failed' || error instanceof URIError || error.status === 400) return res.status(400).json(errorBody('VALIDATION_ERROR', 'Malformed request', {fields: ['body']}));
    console.error('Request failed:', error.message);
    res.status(500).json(errorBody('INTERNAL_ERROR', 'Request could not be completed'));
  });
  return app;
}
