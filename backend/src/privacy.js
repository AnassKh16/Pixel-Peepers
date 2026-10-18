import {createHash, randomUUID} from 'node:crypto';
import {DomainError, validationError} from './validation.js';

const ANONYMOUS = 'Anonymized user';
const initialized = new WeakMap();
let defaultPool;
const fingerprint = value => createHash('sha256').update(value.trim().toLowerCase(), 'utf8').digest('hex');
const schema = `
CREATE TABLE IF NOT EXISTS privacy_redactions (
  user_id text PRIMARY KEY,
  redacted_at timestamptz NOT NULL DEFAULT now(),
  aliases text[] NOT NULL DEFAULT '{}',
  name_hashes text[] NOT NULL DEFAULT '{}'
);
CREATE OR REPLACE FUNCTION day2_clear_privacy_on_reset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN DELETE FROM privacy_redactions; RETURN NULL; END;
$$;
DROP TRIGGER IF EXISTS day2_privacy_reset ON app_state;
CREATE TRIGGER day2_privacy_reset AFTER TRUNCATE ON app_state
FOR EACH STATEMENT EXECUTE FUNCTION day2_clear_privacy_on_reset();
`;

// Exactly the same lock order as reset: reset barrier before the privacy lock.
async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    await client.query('SELECT pg_advisory_xact_lock(5530)');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function initPrivacy(pool = defaultPool) {
  if (!pool) throw new TypeError('Privacy pool is required; call createPrivacy(pool) first');
  if (!initialized.has(pool)) {
    initialized.set(pool, transaction(pool, client => client.query(schema)).catch(error => {
      initialized.delete(pool); throw error;
    }));
  }
  await initialized.get(pool);
}

/** Async helpers: pass a pool explicitly, or bind the default with createPrivacy(pool). */
export async function isRedacted(id, pool = defaultPool) {
  if (typeof id !== 'string') return false;
  await initPrivacy(pool);
  return (await pool.query('SELECT user_id FROM privacy_redactions WHERE user_id=$1', [id])).rows.length > 0;
}
export async function redactName(userIdOrName, pool = defaultPool) {
  if (typeof userIdOrName !== 'string') return userIdOrName;
  await initPrivacy(pool);
  const found = await pool.query(
    'SELECT user_id FROM privacy_redactions WHERE user_id=$1 OR $2=ANY(name_hashes) LIMIT 1',
    [userIdOrName, fingerprint(userIdOrName)]);
  return found.rows.length ? ANONYMOUS : userIdOrName;
}

/** Redact a COPY at the response boundary. Never write this copy into an audit row. */
export async function redactRecord(value, pool = defaultPool) {
  if (Array.isArray(value)) return Promise.all(value.map(item => redactRecord(item, pool)));
  if (!value || typeof value !== 'object') return value;
  const result = {...value};
  const id = value.player_id ?? value.user_id ?? value.id;
  const hidden = id && await isRedacted(id, pool);
  for (const [key, item] of Object.entries(value)) {
    if (key === 'name' || key === 'display_name' || key === 'full_name')
      result[key] = hidden ? ANONYMOUS : await redactName(item, pool);
    else if (hidden && ['email','phone','address','birth_date','date_of_birth','avatar_url','social_handles','bio'].includes(key))
      result[key] = null;
    else if (item && typeof item === 'object') result[key] = await redactRecord(item, pool);
  }
  return result;
}

/**
 * This only DENIES revoked credentials; signature verification remains the existing
 * auth service's job. Mount its middleware before every existing auth/write route.
 * The DB registry revokes JWT subjects across processes and restarts, without
 * storing raw JWTs or changing any existing token-verification function.
 */
export async function isTokenRevoked(authorization, pool = defaultPool) {
  if (typeof authorization !== 'string' || !/^Bearer /i.test(authorization)) return false;
  const token = authorization.slice(7);
  if (/^(guest_|viewer_)/.test(token)) {
    const row = (await pool.query('SELECT data FROM guest_tokens WHERE guest_token=$1', [token])).rows[0];
    return Boolean(row && (row.data.valid === false || row.data.invalidated === true || row.data.anonymized === true));
  }
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch { return false; }
  if (!claims || typeof claims !== 'object') return false;
  const ids = [claims.sub, claims.user_id, claims.player_id].filter(id => typeof id === 'string');
  if (!ids.length) return false;
  await initPrivacy(pool);
  return (await pool.query('SELECT user_id FROM privacy_redactions WHERE user_id=ANY($1::text[]) LIMIT 1', [ids])).rows.length > 0;
}

/**
 * Mutable PII is removed atomically. Immutable history is READ ONLY: remember
 * hashes of former names so read-time helpers can hide those names later.
 */
export async function anonymize(pool, user_id) {
  if (typeof user_id !== 'string' || !user_id.trim()) validationError(['user_id']);
  await initPrivacy(pool);
  return transaction(pool, async client => {
    const prior = (await client.query('SELECT aliases,name_hashes FROM privacy_redactions WHERE user_id=$1', [user_id])).rows[0];
    const candidates = [...new Set([user_id, ...(prior?.aliases ?? [])])];
    const players = (await client.query('SELECT player_id FROM players WHERE player_id=ANY($1::text[])', [candidates])).rows;
    const accounts = (await client.query(
      'SELECT user_id,player_id FROM users WHERE user_id=ANY($1::text[]) OR player_id=ANY($1::text[]) ORDER BY user_id FOR UPDATE', [candidates])).rows;
    if (!prior && !players.length && !accounts.length)
      throw new DomainError(404, 'PLAYER_NOT_FOUND', 'Player does not exist', {user_id});
    const ids = [...new Set([...candidates, ...accounts.flatMap(row => [row.user_id, row.player_id]).filter(Boolean)])];
    const playerIds = [...new Set([...players.map(row => row.player_id), ...accounts.map(row => row.player_id).filter(Boolean)])];
    const profiles = (await client.query('SELECT data FROM player_profiles WHERE player_id=ANY($1::text[])', [playerIds])).rows;
    // Read history only; its append-only trigger and rows are never changed.
    const history = (await client.query('SELECT data FROM roster_history WHERE player_id=ANY($1::text[])', [playerIds])).rows;
    const rosters = (await client.query(`
      SELECT data FROM rosters WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(data->'players','[]'::jsonb)) AS p
        WHERE p->>'player_id'=ANY($1::text[]))
    `, [playerIds])).rows;
    const hashes = new Set(prior?.name_hashes ?? []);
    function remember(value) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(remember); return; }
      for (const [key,item] of Object.entries(value)) {
        if (['name','display_name','full_name'].includes(key) && typeof item === 'string' && item !== ANONYMOUS)
          hashes.add(fingerprint(item));
        else if (item && typeof item === 'object') remember(item);
      }
    }
    profiles.forEach(row=>remember(row.data));
    history.forEach(row=>remember({before:row.data.before,after:row.data.after}));
    rosters.forEach(row=>{
      for(const field of ['players','initial_players'])
        (row.data[field] ?? []).filter(player=>playerIds.includes(player.player_id)).forEach(remember);
    });
    for (const id of ids) await client.query(`
      INSERT INTO privacy_redactions(user_id,aliases,name_hashes) VALUES ($1,$2,$3)
      ON CONFLICT(user_id) DO UPDATE SET aliases=EXCLUDED.aliases,
        name_hashes=ARRAY(SELECT DISTINCT item FROM unnest(privacy_redactions.name_hashes || EXCLUDED.name_hashes) AS item)
    `, [id, ids, [...hashes]]);
    await client.query(`
      UPDATE player_profiles SET data=jsonb_build_object('name','Anonymized user',
        'email',null,'phone',null,'bio',null,'avatar_url',null,'social_handles',null,'anonymized',true)
      WHERE player_id=ANY($1::text[])
    `, [playerIds]);
    for (const field of ['players','initial_players']) {
      await client.query(`
        UPDATE rosters SET data=jsonb_set(data, $2::text[], (
          SELECT COALESCE(jsonb_agg(CASE WHEN item->>'player_id'=ANY($1::text[])
            THEN (item - ARRAY['name','email','phone','address','birth_date','date_of_birth','avatar_url','social_handles'])
              || '{"name":"Anonymized user","email":null,"phone":null,"social_handles":null,"anonymized":true}'::jsonb
            ELSE item END ORDER BY ord), '[]'::jsonb)
          FROM jsonb_array_elements(data->$3) WITH ORDINALITY AS entries(item,ord)
        )) WHERE jsonb_typeof(data->$3)='array'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(data->$3) AS p WHERE p->>'player_id'=ANY($1::text[]))
      `, [playerIds, [field], field]);
    }
    for (const account of accounts) await client.query(
      'UPDATE users SET email=$2,password_hash=$3,player_id=NULL WHERE user_id=$1',
      [account.user_id, 'anonymized-' + createHash('sha256').update(account.user_id, 'utf8').digest('hex') + '@invalid', '!anonymized-' + randomUUID()]);
    await client.query(`
      UPDATE guest_tokens SET data='{"valid":false,"invalidated":true,"anonymized":true,"read_only":true}'::jsonb
      WHERE data->>'user_id'=ANY($1::text[]) OR data->>'registered_user_id'=ANY($1::text[])
        OR data->>'player_id'=ANY($1::text[]) OR data->>'viewer_id'=ANY($1::text[])
        OR data->>'sub'=ANY($1::text[]) OR data->>'owner_id'=ANY($1::text[])
    `, [ids]);
    await client.query('DELETE FROM user_carts WHERE user_id=ANY($1::text[])', [ids]);
    return {user_id, status:'anonymized', pii_retained:false, tokens_wiped:true};
  });
}

export function createPrivacy(pool) {
  defaultPool = pool;
  return {anonymize: id=>anonymize(pool,id), isRedacted: id=>isRedacted(id,pool),
    redactName: name=>redactName(name,pool), redactRecord: record=>redactRecord(record,pool),
    isTokenRevoked: authorization=>isTokenRevoked(authorization,pool)};
}
