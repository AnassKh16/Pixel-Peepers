import {moderate, validateMessages} from './moderation.js';
import {createDLQ} from './dlq.js';
import {renderMetrics, METRICS_CONTENT_TYPE} from './metrics.js';
import {createPrivacy} from './privacy.js';
import {signDay2} from './day2-signature.js';
import {DomainError, isObject, validationError} from './validation.js';

export function validateModeration(body) {
  if (!isObject(body)) validationError(['body']);
  const fields = [];
  if (typeof body.chat_room_id !== 'string' || !body.chat_room_id.trim()) fields.push('chat_room_id');
  if (body.check_dlq !== undefined && typeof body.check_dlq !== 'boolean') fields.push('check_dlq');
  if (body.simulate_failed_notifications !== undefined &&
      (!Number.isSafeInteger(body.simulate_failed_notifications) || body.simulate_failed_notifications < 0))
    fields.push('simulate_failed_notifications');
  if (fields.length) validationError(fields);
  validateMessages(body.incoming_messages);
  return {...body, check_dlq: body.check_dlq ?? true, simulate_failed_notifications: body.simulate_failed_notifications ?? 0};
}

/**
 * In createApp, call registerB3Routes(app, {pool, json}) immediately AFTER
 * const json = express.json(...), BEFORE all existing routes and mobileRouter.
 * This order is required for JWT/guest/viewer revocation to cover the whole app.
 * Optional deps: dlq, signDay2, anonymize(userId), metrics (getter functions).
 * Wire live bus/media measurements as metrics.activeWsConnections/streamBitrateKbps.
 * Queue reset is a DB trigger on the existing reset's app_state TRUNCATE.
 */
export function registerB3Routes(app, deps) {
  const {pool} = deps;
  const dlq = deps.dlq ?? createDLQ(pool);
  const sign = deps.signDay2 ?? signDay2;
  const privacy = deps.privacy ?? createPrivacy(pool);
  const erase = deps.anonymize ?? privacy.anonymize;
  app.use(async (req, res, next) => {
    try {
      // Erasure is idempotent even if its caller repeats with a now-revoked token.
      if (req.method === 'DELETE' && req.path?.startsWith('/audit/v1/privacy/user/')) return next();
      if (await privacy.isTokenRevoked(req.headers?.authorization)) return res.status(401).json({
        error: {code:'UNAUTHENTICATED', message:'Credential invalidated by privacy erasure', details:{}}});
      next();
    } catch(error) {next(error);}
  });
  const scalar = async sql => Number((await pool.query(sql)).rows[0].count);
  let mediaSample;
  const metrics = {
    activeWsConnections: () => Number(app.locals?.activeWsConnections ?? 0),
    activeStreams: () => scalar(`SELECT
      (SELECT count(*) FROM stream_keys WHERE status='active') +
      (SELECT count(*) FROM costream_sessions WHERE data->'response'->>'status'='active') AS count`),
    streamBitrateKbps: async () => {
      const response=await fetch(`${process.env.MEDIA_API_URL ?? 'http://mediamtx:9997'}/v3/paths/list?itemsPerPage=1000`,{signal:AbortSignal.timeout(1500)});
      if(!response.ok)throw new DomainError(503,'NOT_READY','Media measurements unavailable');
      const body=await response.json(),now=performance.now();
      const bytes=body.items.reduce((n,path)=>n+Number(path.bytesReceived??0),0);
      const rate=mediaSample?Math.max(0,bytes-mediaSample.bytes)*8/(now-mediaSample.time):0;
      mediaSample={bytes,time:now};return rate;
    },
    dlqDepth: () => dlq.depth(),
    qrScans: () => scalar("SELECT COALESCE(sum((data->>'scan_count')::bigint),0) AS count FROM qr_mappings"),
    ...deps.metrics,
  };
  // Handles upstream JSON parser errors when mounted immediately after app.use(json).
  app.use((error, _req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({
      error: {code: 'VALIDATION_ERROR', message: 'Malformed JSON', details: {fields: ['body']}}});
    if (error.type === 'entity.too.large') return res.status(413).json({
      error: {code: 'PAYLOAD_TOO_LARGE', message: 'Body exceeds 1 MB', details: {}}});
    next(error);
  });
  const route = (method, path, handler) => app[method](path, ...(method === 'post' && deps.json ? [deps.json] : []), async (req, res, next) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof DomainError) return res.status(error.status).json({
        error: {code: error.code, message: error.message, details: error.details}});
      next(error);
    }
  });
  route('post', '/audit/v1/moderation/test', async (req, res) => {
    const body = validateModeration(req.body);
    const result = moderate(body.incoming_messages);
    // snapshot includes the atomic insert when simulating failure. check_dlq=false
    // does not suppress required response fields or prevent requested simulation.
    const dlq_status = body.simulate_failed_notifications
      ? await dlq.enqueue(body.simulate_failed_notifications) : await dlq.snapshot();
    const payload = {chat_room_id: body.chat_room_id,
      flagged_count: result.filtered_messages.filter(message => message.flagged).length,
      kicked_users: result.kicked_users, queue_depth: dlq_status.queue_depth};
    res.status(200).json({chat_room_id: body.chat_room_id, ...result, dlq_status,
      signature: sign(body.chat_room_id, payload)});
  });
  route('get', '/metrics', async (_req, res) => {
    res.set('Content-Type', METRICS_CONTENT_TYPE).status(200).send(Buffer.from(await renderMetrics(metrics)));
  });
  route('delete', '/audit/v1/privacy/user/:user_id', async (req, res) => {
    res.status(200).json(await erase(req.params.user_id));
  });
  return {dlq, metrics, privacy};
}
