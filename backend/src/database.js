import { hash } from 'bcryptjs';
import { sports, defaultStock } from './baseline.js';
import { validateSport } from './sports.js';
import { seedDemo } from './demo.js';
import { seedDay2 } from './day2-baseline.js';
import { createSigner } from './signature.js';
// Capture the salt only at module startup, including for separately created test apps.
const startupSalt=process.env.DAY1_SALT;
const demoSigner=startupSalt?createSigner(startupSalt):undefined;
// A random bcrypt salt is generated on startup; reuse keeps repeat resets identical.
const demoPasswordHash = process.env.DEMO_PASSWORD_HASH ? Promise.resolve(process.env.DEMO_PASSWORD_HASH) : hash('Nascon@26', 10);

export const schema = `
CREATE TABLE IF NOT EXISTS tenants (tenant_id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS sports (sport_id text PRIMARY KEY, config jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS leagues (league_id text PRIMARY KEY, tenant_id text REFERENCES tenants, config jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS clubs (club_id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants);
CREATE TABLE IF NOT EXISTS players (player_id text PRIMARY KEY, club_id text NOT NULL REFERENCES clubs);
CREATE TABLE IF NOT EXISTS products (product_id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants);
CREATE TABLE IF NOT EXISTS variants (variant_id text PRIMARY KEY, product_id text NOT NULL REFERENCES products, price_minor integer NOT NULL, currency text NOT NULL, stock bigint NOT NULL CHECK(stock >= 0), reserved bigint NOT NULL DEFAULT 0 CHECK(reserved >= 0));
CREATE TABLE IF NOT EXISTS discounts (code text PRIMARY KEY, percent integer NOT NULL);
CREATE TABLE IF NOT EXISTS users (user_id text PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL, role text NOT NULL, tenant_id text REFERENCES tenants, league_id text REFERENCES leagues, club_id text REFERENCES clubs, player_id text REFERENCES players);
CREATE TABLE IF NOT EXISTS app_state (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS matches (match_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS events (event_id text PRIMARY KEY, data jsonb NOT NULL);
ALTER TABLE events ADD COLUMN IF NOT EXISTS match_id text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sequence integer;
ALTER TABLE events ALTER COLUMN match_id SET NOT NULL;
ALTER TABLE events ALTER COLUMN sequence SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS events_match_sequence ON events(match_id, sequence);
CREATE OR REPLACE FUNCTION reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Events are append-only; append a compensation instead';
END;
$$;
DROP TRIGGER IF EXISTS events_immutable ON events;
CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
CREATE TABLE IF NOT EXISTS rosters (roster_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS orders (order_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS order_outbox (order_id text PRIMARY KEY REFERENCES orders(order_id), payload jsonb NOT NULL, published boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS club_profiles (club_id text PRIMARY KEY REFERENCES clubs(club_id), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS player_profiles (player_id text PRIMARY KEY REFERENCES players(player_id), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS product_profiles (product_id text PRIMARY KEY REFERENCES products(product_id), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS roster_requests (request_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE SEQUENCE IF NOT EXISTS roster_audit_seq;
CREATE TABLE IF NOT EXISTS roster_history (audit_id text PRIMARY KEY, player_id text NOT NULL, league_id text NOT NULL, data jsonb NOT NULL);
ALTER TABLE roster_history ADD COLUMN IF NOT EXISTS entry_sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE OR REPLACE FUNCTION reject_roster_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Roster history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS roster_history_immutable ON roster_history;
CREATE TRIGGER roster_history_immutable BEFORE UPDATE OR DELETE ON roster_history FOR EACH ROW EXECUTE FUNCTION reject_roster_history_mutation();
CREATE TABLE IF NOT EXISTS stream_keys (stream_key text PRIMARY KEY, player_id text NOT NULL REFERENCES players, label text NOT NULL, status text NOT NULL CHECK(status IN ('active','revoked')));
CREATE UNIQUE INDEX IF NOT EXISTS stream_keys_one_active ON stream_keys(player_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS creator_streams (player_id text PRIMARY KEY REFERENCES players, stream_key text NOT NULL REFERENCES stream_keys);
CREATE TABLE IF NOT EXISTS costream_sessions (session_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS qr_mappings (entity_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS guest_tokens (guest_token text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS user_carts (user_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS qr_short_code_unique ON qr_mappings((data->>'short_code'));
CREATE TABLE IF NOT EXISTS qr_scan_telemetry (entity_id text NOT NULL REFERENCES qr_mappings, device_family text NOT NULL CHECK(device_family IN ('mobile','desktop')), utc_hour timestamptz NOT NULL, scan_count bigint NOT NULL DEFAULT 0, PRIMARY KEY(entity_id,device_family,utc_hour));
CREATE TABLE IF NOT EXISTS chat_rooms (chat_room_id text PRIMARY KEY, last_sequence integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chat_messages (chat_room_id text NOT NULL REFERENCES chat_rooms, message_id text NOT NULL, sequence integer NOT NULL, data jsonb NOT NULL, request jsonb NOT NULL, PRIMARY KEY(chat_room_id,message_id), UNIQUE(chat_room_id,sequence));
CREATE OR REPLACE FUNCTION notify_match_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('nascon_scores',json_build_object('match_id',NEW.match_id,'refresh',true)::text);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS matches_status_notify ON matches;
CREATE TRIGGER matches_status_notify AFTER UPDATE OF data ON matches FOR EACH ROW WHEN (OLD.data->>'status' IS DISTINCT FROM NEW.data->>'status') EXECUTE FUNCTION notify_match_status_change();
CREATE TABLE IF NOT EXISTS offline_sync (device_id text NOT NULL, action_id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(device_id, action_id));
`;

export async function resetDatabase(pool, redis, body = {}, sign = demoSigner) {
  const seed = body.seed ?? 42;
  const stock = {...defaultStock, ...body.stock};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize resets across callers and application instances.
    await client.query('SELECT pg_advisory_xact_lock(5505)');
    await client.query('ALTER SEQUENCE roster_audit_seq RESTART WITH 1');
    await client.query('TRUNCATE qr_scan_telemetry, chat_messages, chat_rooms, creator_streams, stream_keys, costream_sessions, qr_mappings, guest_tokens, user_carts, club_profiles, player_profiles, product_profiles, roster_requests, roster_history, offline_sync, order_outbox, orders, rosters, events, matches, users, variants, products, discounts, players, clubs, leagues, sports, tenants, app_state');
    for (const [id, name] of [['tenant-alpha', 'Alpha Sports'], ['tenant-beta', 'Beta Athletics']]) {
      await client.query('INSERT INTO tenants VALUES ($1,$2)', [id, name]);
    }
    for (const config of sports) await client.query('INSERT INTO sports VALUES ($1,$2)', [config.sport_id, validateSport(config)]);
    for (const [id, tenant] of [['alpha-1','alpha'], ['alpha-2','alpha'], ['beta-1','beta']]) {
      await client.query('INSERT INTO leagues(league_id,tenant_id) VALUES ($1,$2)', [`league-${id}`, `tenant-${tenant}`]);
      await client.query('INSERT INTO clubs VALUES ($1,$2)', [`club-${id}`, `tenant-${tenant}`]);
      await client.query('INSERT INTO players VALUES ($1,$2)', [`player-${id}`, `club-${id}`]);
    }
    await client.query('INSERT INTO products VALUES ($1,$2)', ['prod-jersey-001','tenant-alpha']);
    for (const [id, amount] of Object.entries(stock)) await client.query('INSERT INTO variants VALUES ($1,$2,450000,$3,$4,0)', [id,'prod-jersey-001','PKR',amount]);
    await client.query('INSERT INTO discounts VALUES ($1,10)', ['WELCOME10']);
    for (const [name, role, league, club, player] of [
      ['admin','super_admin',null,null,null],
      ['organizer','league_organizer','league-alpha-1',null,null],
      ['manager','club_manager',null,'club-alpha-1',null],
      ['player','player',null,'club-alpha-1','player-alpha-1'],
      ['viewer','viewer',null,null,null]
    ]) {
      const id = `user-${name}`;
      await client.query('INSERT INTO users VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id,`${name}@nascon.test`,await demoPasswordHash,role,role === 'super_admin' ? null : 'tenant-alpha',league,club,player]);
    }
    if(!sign)throw new Error('DAY1_SALT must be set at startup');
    await seedDemo(client,seed,sign);
    await seedDay2(client,sign);
    await client.query('INSERT INTO app_state VALUES ($1,$2),($3,$4)', ['seed',JSON.stringify(seed),'baseline_seeded','true']);
    // Redis is dedicated to this application; clear transient state on reset.
    await redis.flushDb();
    await client.query("SELECT pg_notify('nascon_scores',$1)",[JSON.stringify({reset:true})]);
    await client.query('COMMIT');
    return {status: 'reset_complete', seed, sports: sports.map(s => s.sport_id), tenants: ['tenant-alpha','tenant-beta'], stock};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}


