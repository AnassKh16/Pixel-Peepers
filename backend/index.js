const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { sign } = require('./sign');

const SALT = process.env.DAY1_SALT || '';
if (!SALT) console.warn('WARNING: DAY1_SALT is empty. Signatures will be wrong.');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
let seeded = false;

app.use(express.json({ limit: '1mb' }));

// ---------- schema ----------
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
      role TEXT NOT NULL, tenant_id TEXT, scope_id TEXT);
    CREATE TABLE IF NOT EXISTS variants (
      variant_id TEXT PRIMARY KEY, product_id TEXT NOT NULL,
      price_minor INTEGER NOT NULL,
      stock INTEGER NOT NULL CHECK (stock >= 0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0));
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY, value TEXT);
  `);
}

// ---------- reset + baseline seed (Section 5.5) ----------
async function resetAndSeed(seed = 42, stock = {}) {
  const stockM = stock['var-jersey-001-M'] ?? 1;
  const stockL = stock['var-jersey-001-L'] ?? 5;
  const hash = bcrypt.hashSync('Nascon@26', 8);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE tenants, users, variants, app_state');
    await client.query(
      `INSERT INTO tenants VALUES ('tenant-alpha','Alpha Sports'),('tenant-beta','Beta Athletics')`);
    await client.query(
      `INSERT INTO variants (variant_id, product_id, price_minor, stock, reserved) VALUES
       ('var-jersey-001-M','prod-jersey-001',450000,$1,0),
       ('var-jersey-001-L','prod-jersey-001',450000,$2,0)`, [stockM, stockL]);
    await client.query(
      `INSERT INTO users (email, password_hash, role, tenant_id, scope_id) VALUES
       ('admin@nascon.test',$1,'super_admin',NULL,NULL),
       ('organizer@nascon.test',$1,'league_organizer','tenant-alpha','league-alpha-1'),
       ('manager@nascon.test',$1,'club_manager','tenant-alpha','club-alpha-1'),
       ('player@nascon.test',$1,'player','tenant-alpha','player-alpha-1'),
       ('viewer@nascon.test',$1,'viewer','tenant-alpha',NULL)`, [hash]);
    await client.query(
      `INSERT INTO app_state VALUES ('seed',$1),('seeded','yes')`, [String(seed)]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  seeded = true;
  return {
    status: 'reset_complete',
    seed,
    sports: ['football', 'basketball', 'cricket', 'esports'],
    tenants: ['tenant-alpha', 'tenant-beta'],
    stock: { 'var-jersey-001-M': stockM, 'var-jersey-001-L': stockL },
  };
}

// ---------- helpers ----------
function err(res, status, code, message, details = {}) {
  return res.status(status).json({ error: { code, message, details } });
}

// ---------- routes ----------
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    if (!seeded) return res.status(503).json({ status: 'starting' });
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'db_unavailable' });
  }
});

app.post('/audit/v1/reset', async (req, res) => {
  const body = req.body || {};
  const fields = [];
  if (body.seed !== undefined && !Number.isInteger(body.seed)) fields.push('seed');
  if (body.stock !== undefined) {
    const s = body.stock;
    if (typeof s !== 'object' || s === null || Array.isArray(s) ||
        !Object.values(s).every(v => Number.isInteger(v) && v >= 0)) fields.push('stock');
  }
  if (fields.length) {
    return err(res, 400, 'VALIDATION_ERROR', 'Invalid reset body.', { fields });
  }
  try {
    res.json(await resetAndSeed(body.seed ?? 42, body.stock ?? {}));
  } catch (e) {
    console.error(e);
    err(res, 500, 'INTERNAL_ERROR', 'Reset failed.');
  }
});

// ---- TODO (next): /sports, /fixtures, /leagues, /events, /score, /standings,
// ---- /roster/*, /checkout, /inventory, /rbac-matrix, /rbac/*, /api/v1/ping, /offline-sync

// ---------- error handling (400 / 413 per Section 5.2) ----------
app.use((e, req, res, next) => {
  if (e.type === 'entity.too.large') {
    return err(res, 413, 'PAYLOAD_TOO_LARGE', 'Body larger than 1 MB.');
  }
  if (e.type === 'entity.parse.failed' || e instanceof SyntaxError) {
    return err(res, 400, 'VALIDATION_ERROR', 'Malformed JSON.', { fields: [] });
  }
  console.error(e);
  err(res, 500, 'INTERNAL_ERROR', 'Unexpected error.');
});

// ---------- startup ----------
async function start() {
  for (let i = 0; i < 30; i++) {
    try { await pool.query('SELECT 1'); break; }
    catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  await initSchema();
  await resetAndSeed(42, {});
  app.listen(process.env.PORT || 8080, '0.0.0.0', () => console.log('API up'));
}
start().catch(e => { console.error(e); process.exit(1); });