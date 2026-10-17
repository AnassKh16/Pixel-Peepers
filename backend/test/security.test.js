import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createClient } from 'redis';
import { compare } from 'bcryptjs';
import { createApp } from '../src/app.js';
import { createTokenService } from '../src/auth.js';

test('Section 5.13 live security contract', {skip: process.env.RUN_INTEGRATION !== '1'}, async t => {
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
  const redis = createClient({url: process.env.REDIS_URL});
  await redis.connect();
  const jwt = createTokenService();
  const server = createApp(pool, redis, jwt).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, method = 'GET', token, body) => fetch(base + path, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, ...(body === undefined ? {} : {body})});
  const checkError = async (response, status, code) => {
    assert.equal(response.status, status);
    const value = await response.json();
    assert.deepEqual(Object.keys(value), ['error']);
    assert.deepEqual(Object.keys(value.error).sort(), ['code','details','message']);
    assert.equal(value.error.code, code);
    assert.equal(typeof value.error.message, 'string');
    assert.equal(typeof value.error.details, 'object');
    return value.error;
  };
  try {
    assert.equal((await call('/audit/v1/reset', 'POST')).status, 200);
    const matrixResponse = await call('/audit/v1/rbac-matrix', 'POST');
    assert.equal(matrixResponse.status, 200);
    const {tokens, context} = await matrixResponse.json();
    const roles = ['super_admin','league_organizer','club_manager','player','viewer'];
    await t.test('exact context and HS256 tokens bound to all five demo users', async () => {
      assert.deepEqual(context, {
        tenant_id: 'tenant-alpha', foreign_tenant_id: 'tenant-beta',
        own_league_id: 'league-alpha-1', other_league_id: 'league-alpha-2', foreign_league_id: 'league-beta-1',
        own_club_id: 'club-alpha-1', other_club_id: 'club-alpha-2', foreign_club_id: 'club-beta-1',
        own_player_id: 'player-alpha-1', other_player_id: 'player-alpha-2', foreign_player_id: 'player-beta-1'
      });
      assert.deepEqual(Object.keys(tokens).sort(), [...roles].sort());
      const users = (await pool.query('SELECT * FROM users ORDER BY user_id')).rows;
      assert.equal(users.length, 5);
      for (const user of users) {
        assert.match(user.password_hash, /^\$2[aby]\$10\$/);
        assert.ok(await compare('Nascon@26', user.password_hash));
        assert.equal(JSON.parse(Buffer.from(tokens[user.role].split('.')[0], 'base64url')).alg, 'HS256');
        const claims = jwt.verify(`Bearer ${tokens[user.role]}`);
        assert.equal(claims.sub, user.user_id);
        assert.ok(claims.exp - Math.floor(Date.now()/1000) >= 3600);
        for (const key of ['tenant_id','league_id','club_id','player_id']) assert.equal(claims[key], user[key]);
      }
    });
    // Expected decisions are literal contract values, independent of the policy implementation.
    const rows = [
      ['P1', 'POST', '/audit/v1/rbac/tenants', 'ADDDD'],
      ['P2 own', 'POST', '/audit/v1/rbac/leagues/league-alpha-1/fixtures', 'AADDD'],
      ['P2 other', 'POST', '/audit/v1/rbac/leagues/league-alpha-2/fixtures', 'ADDDD'],
      ['P2 foreign', 'POST', '/audit/v1/rbac/leagues/league-beta-1/fixtures', 'ADDDD'],
      ['P3 own', 'POST', '/audit/v1/rbac/clubs/club-alpha-1/roster', 'ADADD'],
      ['P3 other', 'POST', '/audit/v1/rbac/clubs/club-alpha-2/roster', 'ADDDD'],
      ['P3 foreign', 'POST', '/audit/v1/rbac/clubs/club-beta-1/roster', 'ADDDD'],
      ['P4 own', 'POST', '/audit/v1/rbac/clubs/club-alpha-1/products', 'ADADD'],
      ['P4 other', 'POST', '/audit/v1/rbac/clubs/club-alpha-2/products', 'ADDDD'],
      ['P4 foreign', 'POST', '/audit/v1/rbac/clubs/club-beta-1/products', 'ADDDD'],
      ['P5 own', 'PATCH', '/audit/v1/rbac/players/player-alpha-1', 'ADAAD'],
      ['P5 other', 'PATCH', '/audit/v1/rbac/players/player-alpha-2', 'ADDDD'],
      ['P5 foreign', 'PATCH', '/audit/v1/rbac/players/player-beta-1', 'ADDDD'],
      ['P6 own', 'GET', '/audit/v1/rbac/clubs/club-alpha-1', 'AAAAA'],
      ['P6 other', 'GET', '/audit/v1/rbac/clubs/club-alpha-2', 'AAAAA'],
      ['P6 foreign', 'GET', '/audit/v1/rbac/clubs/club-beta-1', 'ADDDD'],
      ['P7', 'GET', '/audit/v1/rbac/platform/config', 'ADDDD']
    ];
    for (const [label, method, path, expected] of rows) {
      for (const [index, role] of roles.entries()) await t.test(`${label} / ${role}: ${expected[index] === 'A' ? '200' : '403'}`, async () => {
        const response = await call(path, method, tokens[role], method === 'GET' ? undefined : '{}');
        if (expected[index] === 'A') {
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), {authorized: true});
        } else await checkError(response, 403, 'FORBIDDEN');
      });
    }
    await t.test('manager can edit another player in own club; player remains self-only', async () => {
      await pool.query('INSERT INTO players VALUES ($1,$2)', ['player-own-club-other','club-alpha-1']);
      assert.equal((await call('/audit/v1/rbac/players/player-own-club-other','PATCH',tokens.club_manager,'{}')).status, 200);
      await checkError(await call('/audit/v1/rbac/players/player-own-club-other','PATCH',tokens.player,'{}'),403,'FORBIDDEN');
    });
    await t.test('missing, malformed, tampered, expired and alg:none are 401 on all seven routes', async () => {
      const [header, payload, signature] = tokens.super_admin.split('.');
      const altered = `${header}.${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
      const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
      const expired = jwt.issue({sub:'user-admin',role:'super_admin'}, -1);
      for (const token of [undefined, 'garbage', altered, none, expired]) {
        for (const [,method,path] of [rows[0],rows[1],rows[4],rows[7],rows[10],rows[13],rows[16]]) {
          await checkError(await call(path,method,token,method === 'GET' ? undefined : '{'),401,'UNAUTHENTICATED');
        }
      }
    });
    await t.test('authorization precedes JSON validation; allowed requests follow global JSON and size rules', async () => {
      await checkError(await call('/audit/v1/rbac/tenants','POST',tokens.viewer,'{'),403,'FORBIDDEN');
      const error = await checkError(await call('/audit/v1/rbac/tenants','POST',tokens.super_admin,'{'),400,'VALIDATION_ERROR');
      assert.deepEqual(error.details.fields, ['body']);
      await checkError(await call('/audit/v1/rbac/tenants','POST',tokens.super_admin,JSON.stringify({value:'x'.repeat(1048576)})),413,'PAYLOAD_TOO_LARGE');
      await checkError(await call('/missing'),404,'NOT_FOUND');
    });
    await t.test('unknown ids are 404; hostile strings never cause 5xx or damage tables', async () => {
      for (const id of ['missing', "x'; DROP TABLE sports;--", '<script>alert(1)</script>']) {
        await checkError(await call(`/audit/v1/rbac/players/${encodeURIComponent(id)}`,'PATCH',tokens.super_admin,'{}'),404,'PLAYER_NOT_FOUND');
      }
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM sports')).rows[0].count,4);
    });
    await t.test('150-request probe: exactly 100 successes, 50 rate limits, exemptions, recovery after 11s', async () => {
      await redis.del('rate:127.0.0.1');
      const start = Date.now();
      const responses = await Promise.all(Array.from({length:150}, () => call('/api/v1/ping')));
      assert.ok(Date.now()-start < 5000);
      assert.equal(responses[0].status,200);
      assert.equal(responses.filter(r => r.status === 200).length,100);
      assert.equal(responses.filter(r => r.status === 429).length,50);
      for (const response of responses) {
        if (response.status === 200) assert.deepEqual(await response.json(),{pong:true});
        else {
          assert.ok(Number(response.headers.get('Retry-After')) >= 1);
          await checkError(response,429,'RATE_LIMITED');
        }
      }
      // Forwarded headers are untrusted and cannot bypass the per-IP limit.
      assert.equal((await fetch(base+'/api/v1/ping',{headers:{'X-Forwarded-For':'203.0.113.9'}})).status,429);
      for (let i=0;i<105;i++) {
        assert.equal((await call('/health')).status,200);
        assert.equal((await call('/audit/v1/rbac-matrix','POST')).status,200);
      }
      await delay(11000);
      const recovered = await call('/api/v1/ping');
      assert.equal(recovered.status,200);
      assert.deepEqual(await recovered.json(),{pong:true});
    });
  } finally {
    await call('/audit/v1/reset','POST');
    await new Promise(resolve => server.close(resolve));
    await redis.quit();
    await pool.end();
  }
});
