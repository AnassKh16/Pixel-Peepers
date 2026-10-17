import { canonical } from './signature.js';
import { DomainError, isObject, validId, validationError } from './validation.js';

const types = ['match_init','match_start','score','discipline','tiebreak_winner','match_end','compensation'];
const compensable = new Set(['score','discipline','tiebreak_winner']);
export function validateEvent(body) {
  if (!isObject(body)) validationError(['body']);
  const fields = [];
  for (const key of ['event_id','match_id']) if (!validId(body[key])) fields.push(key);
  if (!types.includes(body.type)) fields.push('type');
  if (!isObject(body.payload)) fields.push('payload');
  else {
    const payload = body.payload;
    // Reject payloads that cannot be represented by the signature contract before
    // any database lookup (non-finite numbers or excessive nesting).
    try { canonical(payload); }
    catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) fields.push('payload');
      else throw error;
    }
    if (body.type === 'match_init') {
      for (const key of ['sport_id','home_team_id','away_team_id']) if (!validId(payload[key])) fields.push(`payload.${key}`);
      if (validId(payload.home_team_id) && payload.home_team_id === payload.away_team_id) fields.push('payload.away_team_id');
      if (payload.league_id !== undefined && payload.league_id !== null && !validId(payload.league_id)) fields.push('payload.league_id');
    }
    if (['score','discipline','tiebreak_winner'].includes(body.type) && !validId(payload.team_id)) fields.push('payload.team_id');
    if (body.type === 'score' && typeof payload.event_type !== 'string') fields.push('payload.event_type');
    if (body.type === 'discipline' && !Number.isSafeInteger(payload.points)) fields.push('payload.points');
    if (body.type === 'compensation') {
      if (!validId(payload.compensates)) fields.push('payload.compensates');
      if (typeof payload.reason !== 'string') fields.push('payload.reason');
    }
  }
  if (fields.length) validationError(fields);
  // Payload bytes are canonicalized in their entirety for the signature, including extra keys.
  return {event_id: body.event_id, match_id: body.match_id, type: body.type, payload: body.payload};
}

// A pure fold of the log: neither mutable score counters nor sport/event-name branches.
export function projectScore(matchId, meta, config, records) {
  const corrections = new Map(records.filter(record => record.request.type === 'compensation').map(record => [record.request.payload.compensates, record.request.event_id]));
  const innings = config.scoring_model === 'innings';
  const team = team_id => ({team_id, score: 0, wickets: innings ? 0 : null, balls: innings ? 0 : null, overs: innings ? '0.0' : null, fair_play: 0});
  const home = team(meta.home_team_id);
  const away = team(meta.away_team_id);
  const teams = new Map([[home.team_id, home], [away.team_id, away]]);
  let status = 'upcoming';
  let tiebreakWinner = null;
  for (const {request: event} of records) {
    if (corrections.has(event.event_id) || event.type === 'compensation') continue;
    const payload = event.payload;
    if (event.type === 'match_start') status = 'in_progress';
    if (event.type === 'match_end') status = 'completed';
    if (event.type === 'score') {
      const target = teams.get(payload.team_id);
      const definition = config.scoring_events[payload.event_type];
      if (config.scoring_model === 'event') target.score += definition.points;
      if (config.scoring_model === 'round') target.score += definition.rounds;
      if (innings) {
        target.score += definition.runs;
        target.wickets += Number(definition.wicket);
        target.balls += Number(definition.legal_ball);
      }
    }
    if (event.type === 'discipline') teams.get(payload.team_id).fair_play += payload.points;
    if (event.type === 'tiebreak_winner') tiebreakWinner = payload.team_id;
  }
  if (innings) for (const target of teams.values()) target.overs = `${Math.floor(target.balls / config.periods.balls_per_over)}.${target.balls % config.periods.balls_per_over}`;
  const winner = home.score > away.score ? home.team_id : away.score > home.score ? away.team_id : tiebreakWinner;
  let outcome = 'pending';
  if (status === 'completed') outcome = winner === home.team_id ? 'home_win' : winner === away.team_id ? 'away_win' : config.draw_allowed ? 'draw' : 'undecided';
  return {match_id: matchId, sport_id: meta.sport_id, league_id: meta.league_id ?? null,
    status, outcome, winner_team_id: winner, tiebreak_winner_team_id: tiebreakWinner,
    home, away, version: records.length,
    events: records.map(({request, response}) => ({sequence: response.sequence, event_id: request.event_id, type: request.type,
      payload: request.payload, signature: response.signature, compensated: corrections.has(request.event_id), compensated_by: corrections.get(request.event_id) ?? null}))};
}

export async function appendEvent(pool, sign, body, {baseVersion} = {}) {
  const request = validateEvent(body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    await client.query('SELECT pg_advisory_xact_lock(513, hashtext($1))', [request.event_id]);
    const previous = (await client.query('SELECT data FROM events WHERE event_id=$1', [request.event_id])).rows[0]?.data;
    if (previous) {
      if (canonical(previous.request) !== canonical(request)) throw new DomainError(409, 'DUPLICATE_EVENT_ID', 'Event id has already been used');
      await client.query('COMMIT');
      return {status: 200, response: previous.response};
    }
    // Also serialize initialization when there is no match row yet to lock.
    await client.query('SELECT pg_advisory_xact_lock(514, hashtext($1))', [request.match_id]);
    let meta = (await client.query('SELECT data FROM matches WHERE match_id=$1 FOR UPDATE', [request.match_id])).rows[0]?.data;
    let config;
    if (request.type === 'match_init') {
      config = (await client.query('SELECT config FROM sports WHERE sport_id=$1', [request.payload.sport_id])).rows[0]?.config;
      if (!config) throw new DomainError(404, 'SPORT_NOT_FOUND', 'Sport does not exist');
      if (request.payload.league_id !== undefined && request.payload.league_id !== null) {
        if (!(await client.query('SELECT 1 FROM leagues WHERE league_id=$1', [request.payload.league_id])).rowCount) throw new DomainError(404, 'LEAGUE_NOT_FOUND', 'League does not exist');
      }
      if (meta) throw new DomainError(409, 'MATCH_EXISTS', 'Match stream already exists');
      meta = {sport_id: request.payload.sport_id, home_team_id: request.payload.home_team_id, away_team_id: request.payload.away_team_id, league_id: request.payload.league_id ?? null};
      await client.query('INSERT INTO matches(match_id,data) VALUES ($1,$2)', [request.match_id, meta]);
    } else {
      if (!meta) throw new DomainError(404, 'MATCH_NOT_FOUND', 'Match stream does not exist');
      config = (await client.query('SELECT config FROM sports WHERE sport_id=$1', [meta.sport_id])).rows[0].config;
    }
    const records = (await client.query('SELECT data FROM events WHERE match_id=$1 ORDER BY sequence', [request.match_id])).rows.map(row => row.data);
    if (baseVersion !== undefined && baseVersion > records.length) throw new DomainError(409, 'INVALID_BASE_VERSION', 'Base version exceeds server version');
    const projection = projectScore(request.match_id, meta, config, records);
    const payload = request.payload;
    if (['score','discipline','tiebreak_winner'].includes(request.type) && ![meta.home_team_id, meta.away_team_id].includes(payload.team_id)) validationError(['payload.team_id']);
    if (request.type === 'score' && !Object.hasOwn(config.scoring_events, payload.event_type)) throw new DomainError(400, 'UNKNOWN_EVENT_TYPE', 'Scoring event is not configured');
    if (request.type === 'compensation') {
      const target = (await client.query('SELECT match_id, data FROM events WHERE event_id=$1', [payload.compensates])).rows[0];
      if (!target) throw new DomainError(404, 'EVENT_NOT_FOUND', 'Compensated event does not exist');
      if (target.match_id !== request.match_id || !compensable.has(target.data.request.type) || projection.events.some(event => event.event_id === payload.compensates && event.compensated)) throw new DomainError(409, 'INVALID_COMPENSATION', 'Event cannot be compensated');
    }
    if (request.type === 'match_start' && projection.status !== 'upcoming') throw new DomainError(409, 'ILLEGAL_TRANSITION', 'Only upcoming matches can start');
    if (['score','discipline','tiebreak_winner'].includes(request.type) && projection.status !== 'in_progress') throw new DomainError(409, 'MATCH_NOT_IN_PROGRESS', 'Match is not in progress');
    if (request.type === 'match_end') {
      if (projection.status !== 'in_progress') throw new DomainError(409, 'ILLEGAL_TRANSITION', 'Only in-progress matches can end');
      if (projection.home.score === projection.away.score && !config.draw_allowed && !projection.tiebreak_winner_team_id) throw new DomainError(409, 'TIE_NOT_ALLOWED', 'Tied match needs a tie-break winner');
    }
    if (request.type === 'score') {
      const target = projection.home.team_id === payload.team_id ? projection.home : projection.away;
      if (config.scoring_model === 'innings' && (target.balls >= config.periods.innings_per_team * config.periods.overs_per_innings * config.periods.balls_per_over || target.wickets >= config.periods.innings_per_team * config.periods.wickets_per_innings)) throw new DomainError(409, 'INNINGS_COMPLETE', 'Configured innings limit reached');
      if (config.scoring_model === 'round' && [projection.home, projection.away].some(team => team.score >= (config.periods.best_of + 1) / 2)) throw new DomainError(409, 'SERIES_ALREADY_DECIDED', 'Configured series limit reached');
    }
    const sequence = records.length + 1;
    const response = {event_id: request.event_id, match_id: request.match_id, type: request.type, sequence, match_version: sequence, signature: sign(request.event_id, payload)};
    await client.query('INSERT INTO events(event_id,match_id,sequence,data) VALUES ($1,$2,$3,$4)', [request.event_id, request.match_id, sequence, {request, response}]);
    await client.query('COMMIT');
    return {status: 201, response, previous_version: records.length};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function getScore(pool, matchId) {
  // One statement gives metadata, config and every event a consistent read snapshot.
  const row = (await pool.query(`SELECT m.data AS meta, s.config,
    COALESCE((SELECT jsonb_agg(e.data ORDER BY e.sequence) FROM events e WHERE e.match_id=m.match_id), '[]'::jsonb) AS records
    FROM matches m JOIN sports s ON s.sport_id=m.data->>'sport_id' WHERE m.match_id=$1`, [matchId])).rows[0];
  if (!row) throw new DomainError(404, 'MATCH_NOT_FOUND', 'Match stream does not exist');
  return projectScore(matchId, row.meta, row.config, row.records);
}

