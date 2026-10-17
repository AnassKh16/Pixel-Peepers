import { tieBreakOrder } from './baseline.js';
import { DomainError, isObject, integerAtLeast, validationError } from './validation.js';

const periodKeys = {
  event: ['count', 'duration_minutes'],
  innings: ['innings_per_team', 'overs_per_innings', 'balls_per_over', 'wickets_per_innings'],
  round: ['best_of']
};
const eventKeys = {event: ['points'], innings: ['runs', 'legal_ball', 'wicket'], round: ['rounds']};
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key, object[key]]));

// This validator is also used by baseline seeding; every sport has the same schema.
export function validateSport(body) {
  if (!isObject(body)) validationError(['body']);
  const fields = [];
  if (typeof body.sport_id !== 'string' || !/^[a-z0-9_-]{2,40}$/.test(body.sport_id)) fields.push('sport_id');
  if (typeof body.name !== 'string' || Array.from(body.name).length < 1 || Array.from(body.name).length > 80) fields.push('name');
  const knownModel = typeof body.scoring_model === 'string' && Object.hasOwn(periodKeys, body.scoring_model);
  if (!knownModel) fields.push('scoring_model');
  if (!isObject(body.periods)) fields.push('periods');
  else if (knownModel) {
    for (const key of periodKeys[body.scoring_model]) {
      if (!integerAtLeast(body.periods[key], 1)) fields.push(`periods.${key}`);
    }
    if (body.scoring_model === 'round' && Number.isSafeInteger(body.periods.best_of) && body.periods.best_of % 2 !== 1) fields.push('periods.best_of');
  }
  if (!isObject(body.scoring_events) || Object.keys(body.scoring_events).length < 1) fields.push('scoring_events');
  else for (const [name, definition] of Object.entries(body.scoring_events)) {
    const path = `scoring_events.${name}`;
    if (!/^[a-z0-9_]{1,40}$/.test(name) || !isObject(definition)) { fields.push(path); continue; }
    if (knownModel) for (const key of eventKeys[body.scoring_model]) {
      const valid = body.scoring_model === 'innings' && key !== 'runs'
        ? typeof definition[key] === 'boolean'
        : integerAtLeast(definition[key], body.scoring_model === 'innings' ? 0 : 1);
      if (!valid) fields.push(`${path}.${key}`);
    }
  }
  if (typeof body.draw_allowed !== 'boolean') fields.push('draw_allowed');
  if (!isObject(body.overtime)) fields.push('overtime');
  else {
    if (!['none','extra_time','shootout','golden_score','super_over'].includes(body.overtime.policy)) fields.push('overtime.policy');
    if (body.overtime.duration_minutes !== undefined && !integerAtLeast(body.overtime.duration_minutes, 0)) fields.push('overtime.duration_minutes');
  }
  if (body.tie_break_order !== undefined && (!Array.isArray(body.tie_break_order) || body.tie_break_order.some(key => !tieBreakOrder.includes(key)) || new Set(body.tie_break_order).size !== body.tie_break_order.length)) fields.push('tie_break_order');
  if (!isObject(body.roster)) fields.push('roster');
  else {
    for (const key of ['min_squad_size', 'max_squad_size']) if (!integerAtLeast(body.roster[key], 1)) fields.push(`roster.${key}`);
    if (integerAtLeast(body.roster.min_squad_size, 1) && integerAtLeast(body.roster.max_squad_size, 1) && body.roster.min_squad_size > body.roster.max_squad_size) fields.push('roster.max_squad_size');
    if (!isObject(body.roster.required_positions)) fields.push('roster.required_positions');
    else for (const [position, count] of Object.entries(body.roster.required_positions)) {
      if (!integerAtLeast(count, 0)) fields.push(`roster.required_positions.${position}`);
    }
  }
  if (fields.length) validationError(fields);
  const configuredOrder = body.tie_break_order ?? tieBreakOrder;
  return {
    sport_id: body.sport_id, name: body.name, scoring_model: body.scoring_model,
    periods: pick(body.periods, periodKeys[body.scoring_model]),
    scoring_events: Object.fromEntries(Object.entries(body.scoring_events).map(([name, definition]) => [name, pick(definition, eventKeys[body.scoring_model])])),
    draw_allowed: body.draw_allowed,
    overtime: {policy: body.overtime.policy, ...(body.overtime.duration_minutes === undefined ? {} : {duration_minutes: body.overtime.duration_minutes})},
    tie_break_order: [...configuredOrder.filter(key => key !== 'draw_lots'), 'draw_lots'],
    roster: {min_squad_size: body.roster.min_squad_size, max_squad_size: body.roster.max_squad_size, required_positions: {...body.roster.required_positions}}
  };
}

export async function createSport(pool, body) {
  const config = validateSport(body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    const result = await client.query('INSERT INTO sports(sport_id,config) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING sport_id', [config.sport_id, config]);
    if (!result.rowCount) throw new DomainError(409, 'SPORT_EXISTS', 'Sport id already exists');
    await client.query('COMMIT');
    return {sport_id: config.sport_id, status: 'created', config};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
