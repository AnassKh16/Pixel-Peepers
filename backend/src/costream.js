import {createHash} from 'node:crypto';
import {canonical} from './signature.js';
import {signDay2} from './day2-signature.js';
import {DomainError, isObject, validationError} from './validation.js';

export function validateSession(body) {
  if (!isObject(body)) validationError(['body']);
  const fields = [];
  for (const key of ['session_id', 'host_player_id']) if (typeof body[key] !== 'string' || !body[key].length) fields.push(key);
  if (!Array.isArray(body.participants) || !body.participants.length || body.participants.some(id => typeof id !== 'string' || !id.length) || new Set(body.participants).size !== body.participants.length) fields.push('participants');
  if (body.simulate_host_drop !== undefined && typeof body.simulate_host_drop !== 'boolean') fields.push('simulate_host_drop');
  if (body.layout !== undefined && !['solo', 'grid_2', 'grid_4', 'spotlight'].includes(body.layout)) fields.push('layout');
  if (fields.length) validationError(fields);
  return {session_id: body.session_id, host_player_id: body.host_player_id, participants: [...body.participants], layout: body.layout ?? 'grid_4', simulate_host_drop: body.simulate_host_drop ?? false};
}

export async function manageSession(pool, body, sign = signDay2) {
  const request = validateSession(body), client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    await client.query('SELECT pg_advisory_xact_lock(521,hashtext($1))', [request.session_id]);
    const ids = [...new Set([...request.participants, request.host_player_id])];
    const found = new Set((await client.query('SELECT player_id FROM players WHERE player_id=ANY($1::text[])', [ids])).rows.map(row => row.player_id));
    if (ids.some(id => !found.has(id))) throw new DomainError(404, 'PLAYER_NOT_FOUND', 'Participant does not exist');
    if (!request.participants.includes(request.host_player_id)) validationError(['host_player_id']);
    if (request.participants.length > 4) throw new DomainError(409, 'COSTREAM_SESSION_FULL', 'At most four participants are allowed');
    const active = request.simulate_host_drop ? request.participants.filter(id => id !== request.host_player_id) : request.participants;
    if ((request.layout === 'solo' && active.length > 1) || (request.layout === 'grid_2' && active.length > 2)) throw new DomainError(400, 'UNSUPPORTED_LAYOUT', 'Layout cannot fit active participants');
    const saved = (await client.query('SELECT data FROM costream_sessions WHERE session_id=$1', [request.session_id])).rows[0]?.data;
    const fingerprint = createHash('sha256').update(canonical(request)).digest('hex');
    const replay = saved?.replays?.[fingerprint] ?? (saved && canonical(saved.request) === canonical(request) ? saved.response : null);
    if (replay) {
      await client.query('COMMIT'); return {status: 200, response: replay};
    }
    const response = {session_id: request.session_id, status: active.length ? 'active' : 'terminated',
      active_host: request.simulate_host_drop ? active[0] ?? null : request.host_player_id,
      handoff_occurred: request.simulate_host_drop && active.length > 0,
      participant_count: active.length, active_participants: active, layout: request.layout,
      composite_playback_url: `http://localhost:8888/costream/${encodeURIComponent(request.session_id)}/index.m3u8`,
      chat_room_id: `chat-${request.session_id}`};
    const payload = Object.fromEntries(['active_host', 'handoff_occurred', 'layout', 'participant_count', 'session_id', 'status'].map(key => [key, response[key]]));
    response.signature = sign(request.session_id, payload);
    await client.query('INSERT INTO costream_sessions(session_id,data) VALUES ($1,$2) ON CONFLICT(session_id) DO UPDATE SET data=EXCLUDED.data', [request.session_id, {request, response, replays: {...saved?.replays, [fingerprint]: response}}]);
    await client.query('COMMIT'); return {status: 201, response};
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
