// Executes the actual TypeScript API/storage code against a file-backed SQLite adapter.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require(require.resolve('typescript', { paths: [path.resolve(__dirname, '..'), path.resolve(__dirname, '../.checks')] }));
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const testFolder = path.join(root, '.tmp');
fs.mkdirSync(testFolder, { recursive: true });
const filename = path.join(testFolder, `services-${process.pid}.db`);
const connections = [];
const secure = new Map();
function loader() {
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = name => {
      if (name === 'expo-crypto') return { randomUUID: crypto.randomUUID };
      if (name === 'expo-secure-store') return { getItemAsync: async key => secure.get(key) || null, setItemAsync: async (key, value) => { secure.set(key, value); } };
      if (name === 'expo-sqlite') return { openDatabaseAsync: async () => {
        const connection = new DatabaseSync(filenameForDB()); connections.push(connection);
        return { execAsync: async sql => connection.exec(sql),
          runAsync: async (sql, ...args) => connection.prepare(sql).run(...args),
          getFirstAsync: async (sql, ...args) => connection.prepare(sql).get(...args),
          getAllAsync: async (sql, ...args) => connection.prepare(sql).all(...args),
          withTransactionAsync: async task => { connection.exec('BEGIN'); try { await task(); connection.exec('COMMIT'); } catch (e) { connection.exec('ROLLBACK'); throw e; } },
        };
      } };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
      return require(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  return relative => load(path.join(root, relative));
}
const filenameForDB = () => filename;

if (process.argv.includes('--live-readonly')) {
  (async () => {
    try {
      const load = loader(); const config = load('src/config.ts'); if (process.env.SKORLY_TEST_SERVER) config.BASE_URL = process.env.SKORLY_TEST_SERVER; const api = load('src/services/api.ts');
      await api.signIn('manager@nascon.test', 'Nascon@26');
      const leagues = await api.getLeagues();
      const fixtures = await api.getFixtures();
      const match = fixtures[0] ? await api.getMatch(fixtures[0].id) : null;
      const standings = leagues[0] ? await api.getStandings(leagues[0].id) : [];
      const products = await api.getProducts(); const club = await api.getClub(); const sport = match ? await api.getSport(match.sport) : null;
      console.log(JSON.stringify({ connected: !leagues.some(l => l.cached), leagues: leagues.length, fixtures: fixtures.length, match: match?.id, standings: standings.length, products: products.length, club: club.id, roster: club.roster.length, eventTypes: sport ? Object.keys(sport.scoring_events) : [] }));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
    finally { for (const connection of connections) connection.close(); fs.rmSync(filename, { force: true }); }
  })();
} else test('REST contracts: auth, cached reads, variants, payment retry, receipt and rebased sync', async () => {
  const load = loader(); const api = load('src/services/api.ts'); const storage = load('src/storage/database.ts');
  const originalFetch = global.fetch; const calls = []; let offline = false; let authFailure = false; let failCheckoutOnce = false; let sportMissing = true;
  const teams = [{ team_id: 'team-alpha-1', name: 'Alpha United' }, { team_id: 'team-alpha-2', name: 'Beta Athletic' }];
  const seen = new Set();
  const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  global.fetch = async (url, options) => {
    const route = new URL(url).pathname; const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ route, body, headers: options.headers });
    if (offline) throw new TypeError('Network unavailable');
    if (route.endsWith('/auth/login')) return body.password === 'Nascon@26' ? reply({ token: 'real-jwt-test', role: 'club_manager', user: { id: 'user-manager', email: 'manager@nascon.test', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1', league_id: null, player_id: null } }) : reply({ error: { code: 'UNAUTHENTICATED' } }, 401);
    assert.equal(options.headers.Authorization, 'Bearer real-jwt-test');
    if (authFailure) return reply({ error: { code: 'UNAUTHENTICATED' } }, 401);
    if (route.endsWith('/leagues')) return reply({ leagues: [{ league_id: 'league-alpha-1', name: 'Alpha Premier', sport_id: 'football', teams }] });
    if (route.endsWith('/fixtures')) return reply({ fixtures: [{ match_id: 'demo-match-alpha-3', league_id: 'league-alpha-1', sport_id: 'football', starts_at: null, status: 'in_progress', home: teams[0], away: teams[1], score: { home: { team_id: teams[0].team_id, score: 2 }, away: { team_id: teams[1].team_id, score: 1 } }, version: 3 }] });
    if (route.includes('/matches/')) return reply({ match_id: 'demo-match-alpha-3', league_id: 'league-alpha-1', sport_id: 'football', status: 'in_progress', home: { team_id: teams[0].team_id, score: 2 }, away: { team_id: teams[1].team_id, score: 1 }, version: 3, events: [{ event_id: 'e1', sequence: 1, type: 'score', payload: { team_id: teams[0].team_id, event_type: 'configured_score' }, compensated: false }] });
    if (route.endsWith('/standings')) return reply({ table: [{ team_id: teams[0].team_id, played: 1, won: 1, drawn: 0, lost: 0, diff: 1, points: 3, status: 'clinched' }] });
    if (route.includes('/sports/')) return sportMissing ? reply({ error: { code: 'SPORT_NOT_FOUND' } }, 404) : reply({ sport_id: 'football', name: 'Football', scoring_model: 'goals', periods: 2, scoring_events: { configured_score: { points: 1 } }, draw_allowed: true, overtime: {}, tie_break_order: [], roster: {} });
    if (route.endsWith('/products')) return reply({ products: [{ product_id: 'prod-jersey-001', name: 'Alpha Home Jersey', description: 'Official jersey', variants: [{ variant_id: 'var-jersey-001-M', size: 'M', color: 'Blue', price_minor: 450000, currency: 'PKR', stock: 10, reserved: 0 }] }] });
    if (route.includes('/clubs/')) return reply({ club_id: 'club-alpha-1', name: 'Alpha United', home_venue: { name: 'Ground', address: 'Islamabad' }, social_handles: { instagram: '@alpha' }, staff: [{ name: 'Coach', role: 'coach' }], roster: [{ player_id: 'demo-player-alpha-12', name: 'Ali', position: 'gk', squad_id: 'squad-alpha-1', role: 'captain', league_id: 'league-alpha-1' }] });
    if (route.endsWith('/checkout')) {
      if (body.payment.token === 'tok_declined') return reply({ error: { code: 'PAYMENT_DECLINED' } }, 402);
      if (body.payment.token === 'tok_capture_fail') return reply({ error: { code: 'PAYMENT_CAPTURE_FAILED' } }, 402);
      if (body.items[0].quantity > 5) return reply({ error: { code: 'OUT_OF_STOCK' } }, 409);
      if (failCheckoutOnce) { failCheckoutOnce = false; throw new TypeError('Response lost'); }
      return reply({ order_id: body.order_id, status: 'paid', items: [{ ...body.items[0], unit_price_minor: 450000 }], subtotal_minor: 450000, discount_minor: 45000, total_minor: 405000, receipt: { payload: { paid_at: '2026-10-17T09:00:00Z' }, pdf_base64: Buffer.from('%PDF-1.4\nserver-receipt').toString('base64') } }, 201);
    }
    if (route.endsWith('/offline-sync')) return reply({ results: body.actions.map(action => {
      const duplicate = seen.has(action.action_id); seen.add(action.action_id);
      return { action_id: action.action_id, status: duplicate ? 'skipped_duplicate' : action.payload.reason === 'full' ? 'rejected' : 'applied', resolution: action.base_version === 0 ? 'rebased_append' : 'appended', server_version: 4, error: action.payload.reason === 'full' ? { code: 'SQUAD_FULL', message: 'Full squad' } : null };
    }) });
    throw new Error(`Unexpected route ${route}`);
  };
  try {
    await assert.rejects(api.signIn('manager@nascon.test', 'bad'), /email or password/);
    const account = await api.signIn('manager@nascon.test', 'Nascon@26'); assert.equal(account.user.id, 'user-manager'); assert.equal(secure.get('skorly.token'), 'real-jwt-test');
    assert.equal((await api.getLeagues())[0].id, 'league-alpha-1');
    const fixture = (await api.getFixtures())[0]; assert.equal(fixture.homeScore, 2); assert.equal(fixture.cached, false); assert.equal(fixture.startsAt, '');
    assert.equal((await api.getMatch(fixture.id)).home, 'Alpha United');
    assert.equal((await api.getStandings('league-alpha-1'))[0].status, 'Clinched');
    assert.equal(await api.getSport('football'), null, 'missing sport route must not invent rules'); sportMissing = false;
    assert.deepEqual(Object.keys((await api.getSport('football')).scoring_events), ['configured_score']);
    const club = await api.getClub(); assert.equal(club.roster[0].squadId, 'squad-alpha-1');
    const product = (await api.getProducts())[0]; assert.equal(product.price, 4500); assert.equal(product.variants[0].id, 'var-jersey-001-M');
    offline = true;
    assert.equal((await api.getFixtures())[0].cached, true); assert.equal((await api.getMatch(fixture.id, false)).cached, true);
    assert.equal((await api.getStandings('league-alpha-1', false))[0].cached, true);
    assert.equal((await api.getClub(false)).roster[0].name, 'Ali'); assert.equal((await api.getSport('football', false)).cached, true);
    offline = false; authFailure = true; await assert.rejects(api.getFixtures(), /sign-in has expired/); authFailure = false;
    const items = [{ product, variantId: product.variants[0].id, size: 'M', color: 'Blue', quantity: 1 }];
    assert.equal(api.quote(items, 'WELCOME10').total, 4050); assert.equal(api.money(4500), 'PKR 4,500.00');
    await assert.rejects(api.checkout(items, '', 'declined', true, account.email), /payment was declined/);
    await assert.rejects(api.checkout(items, '', 'capture_fail', true, account.email), /could not be completed/);
    await assert.rejects(api.checkout([{ ...items[0], quantity: 6 }], '', 'success', true, account.email), /not enough stock/);
    failCheckoutOnce = true;
    await assert.rejects(api.checkout(items, 'WELCOME10', 'success', true, account.email), /Cannot reach/);
    const failedId = calls.filter(c => c.route.endsWith('/checkout')).at(-1).body.order_id;
    const order = await api.checkout(items, 'WELCOME10', 'success', true, account.email);
    assert.equal(order.id, failedId, 'lost responses must retry the stable order id');
    assert.equal(order.total, 4050); assert.match(Buffer.from(order.pdfBase64, 'base64').toString(), /^%PDF/);
    assert.equal((await api.getOrders(account.email)).length, 1);
    const roster = { action_id: crypto.randomUUID(), type: 'roster_transfer', queued_at: new Date().toISOString(), base_version: 0, payload: { request_id: 'stable-roster-id', player_id: 'demo-player-alpha-12', league_id: 'league-alpha-1', type: 'transfer', from_squad_id: 'squad-alpha-1', to_squad_id: 'squad-alpha-2', effective_date: '2026-10-17', reason: 'Move' } };
    const rejected = { ...roster, action_id: crypto.randomUUID(), payload: { ...roster.payload, request_id: 'rejected-request', reason: 'full' } };
    await storage.writeCache('test:queue', [roster, rejected]);
    assert.equal((await loader()('src/storage/database.ts').readCache('test:queue')).length, 2, 'queue survives a fresh database connection');
    const results = await api.syncActions([roster, rejected]); assert.equal(results[0].status, 'Applied'); assert.match(results[0].reason, /newer updates/); assert.equal(results[1].reason, 'This squad is already full.');
    const wire = calls.at(-1).body; assert.equal(wire.actions[0].type, 'roster_action'); assert.equal(wire.actions[0].base_version, 0); assert.equal(wire.actions[0].payload.request_id, 'stable-roster-id');
    assert.equal(roster.type, 'roster_transfer', 'wire adaptation does not mutate the local queue item');
    assert.equal((await api.syncActions([roster]))[0].status, 'Already processed'); assert.equal(calls.at(-1).body.device_id, wire.device_id);
    const event = { action_id: crypto.randomUUID(), type: 'score_event', queued_at: new Date().toISOString(), base_version: 1, payload: { event_id: 'stable-event-id', match_id: fixture.id, type: 'score', payload: { team_id: fixture.homeId, event_type: 'configured_score' } } };
    await api.syncActions([event]); assert.equal(calls.at(-1).body.actions[0].payload.event_id, 'stable-event-id');
    assert.equal(calls.at(-1).body.actions[0].base_version, 1);
  } finally { global.fetch = originalFetch; for (const connection of connections) connection.close(); fs.rmSync(filename, { force: true }); }
});


