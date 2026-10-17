import { hash } from 'bcryptjs';
import { sports, defaultStock } from './baseline.js';
// A random bcrypt salt is generated on startup; reuse keeps repeat resets identical.
const demoPasswordHash = hash('Nascon@26', 10);

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
CREATE TABLE IF NOT EXISTS rosters (roster_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS orders (order_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS offline_sync (device_id text NOT NULL, action_id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(device_id, action_id));
`;

export async function resetDatabase(pool, redis, body = {}) {
  const seed = body.seed ?? 42;
  const stock = {...defaultStock, ...body.stock};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize resets across callers and application instances.
    await client.query('SELECT pg_advisory_xact_lock(5505)');
    await client.query('TRUNCATE offline_sync, orders, rosters, events, matches, users, variants, products, discounts, players, clubs, leagues, sports, tenants, app_state');
    for (const [id, name] of [['tenant-alpha', 'Alpha Sports'], ['tenant-beta', 'Beta Athletics']]) {
      await client.query('INSERT INTO tenants VALUES ($1,$2)', [id, name]);
    }
    for (const config of sports) await client.query('INSERT INTO sports VALUES ($1,$2)', [config.sport_id, config]);
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
    await client.query('INSERT INTO app_state VALUES ($1,$2),($3,$4)', ['seed',JSON.stringify(seed),'baseline_seeded','true']);
    // Redis is dedicated to this application; clear transient state on reset.
    await redis.flushDb();
    await client.query('COMMIT');
    return {status: 'reset_complete', seed, sports: sports.map(s => s.sport_id), tenants: ['tenant-alpha','tenant-beta'], stock};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
