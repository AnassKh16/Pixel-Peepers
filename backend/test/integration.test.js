import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createClient } from 'redis';

test('live readiness, reset defaults, overrides, validation and deterministic database state', {skip: process.env.RUN_INTEGRATION !== '1'}, async () => {
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
  const redis = createClient({url: process.env.REDIS_URL});
  await redis.connect();
  const reset = body => fetch(((process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080') + '/audit/v1/reset'), {method: 'POST', headers: {'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  try {
    assert.deepEqual(await (await fetch(((process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080') + '/health'))).json(), {status: 'ok'});
    const expected = {status: 'reset_complete', seed: 42, sports: ['football','basketball','cricket','esports'], tenants: ['tenant-alpha','tenant-beta'], stock: {'var-jersey-001-M': 1, 'var-jersey-001-L': 5}};
    assert.deepEqual(await (await reset()).json(), expected);
    const snapshot = async () => {
      const result = {};
      for (const table of ['tenants','sports','leagues','clubs','players','products','variants','discounts','users','app_state','matches','events','club_profiles','player_profiles','product_profiles','rosters']) {
        result[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
      }
      return result;
    };
    const first = await snapshot();
    assert.equal(first.users.length, 5);
    assert.deepEqual(first.leagues.map(r => r.league_id), ['league-alpha-1','league-alpha-2','league-beta-1']);
    await pool.query("INSERT INTO matches VALUES ('temporary', '{}')");
    await redis.set('temporary', 'value');
    assert.deepEqual(await (await reset()).json(), expected);
    assert.deepEqual(await snapshot(), first);
    assert.equal((await pool.query('SELECT * FROM matches')).rowCount, 7);
    assert.equal((await pool.query('SELECT * FROM matches WHERE match_id=$1',['temporary'])).rowCount,0);
    assert.equal(await redis.get('temporary'), null);
    const override = await (await reset({seed: 7, stock: {'var-jersey-001-M': 0}})).json();
    assert.equal(override.seed, 7);
    assert.deepEqual(override.stock, {'var-jersey-001-M': 0,'var-jersey-001-L': 5});
    for (const body of [null, [], {seed: '42'}, {stock: {'var-jersey-001-M': -1}}]) {
      const response = await reset(body);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    }
    const malformed = await fetch(((process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080') + '/audit/v1/reset'), {method: 'POST',headers: {'Content-Type':'application/json'},body:'{'});
    assert.equal(malformed.status, 400);
    const oversized = await reset({ignored: 'x'.repeat(1024 * 1024)});
    assert.equal(oversized.status, 413);
    await reset();
  } finally { await redis.quit(); await pool.end(); }
});

