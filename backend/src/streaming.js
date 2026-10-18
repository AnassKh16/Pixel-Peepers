import {randomBytes} from 'node:crypto';
import {DomainError, isObject, validationError} from './validation.js';
import {signDay2} from './day2-signature.js';

export function validateStreamKey(body) {
  if (!isObject(body)) validationError(['body']);
  const fields = [];
  if (!['generate', 'rotate', 'revoke'].includes(body.action)) fields.push('action');
  if (typeof body.player_id !== 'string' || !body.player_id.length) fields.push('player_id');
  if (body.label !== undefined && (typeof body.label !== 'string' || Array.from(body.label).length < 1 || Array.from(body.label).length > 64)) fields.push('label');
  if (body.stream_key_override !== undefined && (typeof body.stream_key_override !== 'string' || !body.stream_key_override.length)) fields.push('stream_key_override');
  if (fields.length) validationError(fields);
  return {action: body.action, player_id: body.player_id, label: body.label ?? 'default', stream_key_override: body.stream_key_override};
}

export async function manageStreamKey(pool, body, sign = signDay2) {
  const request = validateStreamKey(body), client = await pool.connect();
  let committed = false;
  const invalidated = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    if (!(await client.query('SELECT player_id FROM players WHERE player_id=$1 FOR UPDATE', [request.player_id])).rowCount)
      throw new DomainError(404, 'PLAYER_NOT_FOUND', 'Player does not exist');
    const current = (await client.query('SELECT k.* FROM creator_streams c JOIN stream_keys k USING(stream_key) WHERE c.player_id=$1', [request.player_id])).rows[0];
    let streamKey;
    if (request.action === 'revoke') {
      if (!current) throw new DomainError(404, 'STREAM_NOT_FOUND', 'Player has no stream key');
      streamKey = current.stream_key;
      invalidated.push(streamKey);
      await client.query("UPDATE stream_keys SET status='revoked' WHERE stream_key=$1", [streamKey]);
    } else {
      streamKey = request.stream_key_override ?? `sk_live_${randomBytes(8).toString('hex')}`;
      // Serialize override collisions across different creators as well as one player.
      await client.query('SELECT pg_advisory_xact_lock(520, hashtext($1))', [streamKey]);
      const existing = (await client.query('SELECT player_id,status FROM stream_keys WHERE stream_key=$1', [streamKey])).rows[0];
      if (existing?.status === 'revoked') throw new DomainError(409, 'KEY_REVOKED', 'Revoked stream keys cannot be reused');
      if (existing && existing.player_id !== request.player_id) validationError(['stream_key_override']);
      const old = await client.query("UPDATE stream_keys SET status='revoked' WHERE player_id=$1 AND stream_key<>$2 AND status='active' RETURNING stream_key", [request.player_id, streamKey]);
      invalidated.push(...old.rows.map(row => row.stream_key));
      await client.query("INSERT INTO stream_keys(stream_key,player_id,label,status) VALUES ($1,$2,$3,'active') ON CONFLICT(stream_key) DO UPDATE SET label=EXCLUDED.label", [streamKey, request.player_id, request.label]);
      await client.query('INSERT INTO creator_streams(player_id,stream_key) VALUES ($1,$2) ON CONFLICT(player_id) DO UPDATE SET stream_key=EXCLUDED.stream_key', [request.player_id, streamKey]);
    }
    const status = request.action === 'revoke' ? 'revoked' : 'active';
    const response = {player_id: request.player_id, label: request.label, stream_key: streamKey, status,
      ingest_endpoints: status === 'revoked' ? null : {rtmp: `rtmp://localhost:1935/live/${streamKey}`, webrtc: `http://localhost:8889/live/${streamKey}/whip`},
      playback_url: status === 'revoked' ? null : `http://localhost:8888/live/${streamKey}/index.m3u8`,
      signature: sign(streamKey, {action: request.action, player_id: request.player_id, status, stream_key: streamKey})};
    await client.query('COMMIT');
    committed = true;
    await disconnectMediaKeys(invalidated);
    return {status: request.action === 'generate' ? 201 : 200, response};
  } catch (error) { if (!committed) await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

// MediaMTX sends this callback for every new publish/read/playback authentication.
// A non-2xx response makes the real media server refuse the operation.
export async function authorizeMedia(pool, body) {
  if (!isObject(body) || typeof body.path !== 'string' || !['publish', 'read', 'playback'].includes(body.action)) validationError(['path', 'action']);
  const path = body.path.replace(/^\//, '');
  if (path.startsWith('live/')) {
    const key = path.slice(5);
    const row = (await pool.query('SELECT status FROM stream_keys WHERE stream_key=$1', [key])).rows[0];
    if (!row) throw new DomainError(404, 'STREAM_NOT_FOUND', 'Stream key does not exist');
    if (row.status !== 'active') throw new DomainError(409, 'KEY_REVOKED', 'Stream key has been revoked');
    return;
  }
  if (path.startsWith('costream/') && body.action !== 'publish') {
    const row = (await pool.query('SELECT data FROM costream_sessions WHERE session_id=$1', [path.slice(9)])).rows[0];
    if (row?.data.response.status === 'active') return;
  }
  throw new DomainError(404, 'STREAM_NOT_FOUND', 'Stream does not exist');
}

export async function mediaReady(url = process.env.MEDIA_API_URL ?? 'http://mediamtx:9997') {
  const response = await fetch(`${url}/v3/paths/list`, {signal: AbortSignal.timeout(1500)});
  if (!response.ok) throw new Error('Media server is not ready');
  const body = await response.json();
  if (!Array.isArray(body.items)) throw new Error('Invalid media server readiness response');
}

// Invalidate existing publishers/readers as well as refusing their next connection.
export async function disconnectMediaKeys(keys, url = process.env.MEDIA_API_URL ?? 'http://mediamtx:9997') {
  if (!keys.length) return;
  const paths = new Set(keys.map(key => `live/${key}`));
  const collections = {rtmpConn: 'rtmpconns', webRTCSession: 'webrtcsessions'};
  const request = async (route, method = 'GET') => {
    let response;
    try { response = await fetch(`${url}${route}`, {method, signal: AbortSignal.timeout(1500)}); }
    catch { throw new DomainError(503, 'NOT_READY', 'Media server control API is unavailable'); }
    if (!response.ok && !(method === 'POST' && response.status === 404))
      throw new DomainError(503, 'NOT_READY', 'Media server could not disconnect revoked key');
    return response;
  };
  for (let page = 0; ; page++) {
    const listing = await (await request(`/v3/paths/list?page=${page}&itemsPerPage=100`)).json();
    const targets = new Map();
    for (const path of listing.items) if (paths.has(path.name)) {
      for (const connection of [path.source, ...(path.readers ?? [])]) {
        if (connection && collections[connection.type]) targets.set(`${collections[connection.type]}/${connection.id}`, connection);
      }
    }
    await Promise.all([...targets.keys()].map(target => {
      const [collection, id] = target.split('/');
      return request(`/v3/${collection}/kick/${encodeURIComponent(id)}`, 'POST');
    }));
    if (page + 1 >= (listing.pageCount ?? 1)) break;
  }
}
