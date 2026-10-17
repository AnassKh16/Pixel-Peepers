import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createSigner} from '../src/signature.js';
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:8080';
const call=async(path,token,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json(),headers:r.headers};};
const reset=()=>call('/audit/v1/reset',null,{});
const event=(id,match='demo-match-alpha-4',type='match_start',payload={})=>({event_id:id,match_id:match,type,payload});
const action=(id,payload,base_version=0,type='score_event',queued_at='2026-10-17T10:00:00Z')=>({action_id:id,type,payload,base_version,queued_at});
test('mobile API authentication, demo data, tenant scope and queued actions',{skip:process.env.RUN_INTEGRATION!=='1',timeout:120000},async t=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),tokens={};
  try{
    await reset();
    await t.test('five demo logins, exact account shape, HS256 lifetime and shared audit token format',async()=>{
      for(const name of ['admin','organizer','manager','player','viewer']){
        const r=await call('/api/v1/auth/login',null,{email:`${name}@nascon.test`,password:'Nascon@26'});assert.equal(r.status,200);tokens[name]=r.body.token;
        assert.deepEqual(Object.keys(r.body.user).sort(),['id','email','tenant_id','club_id','league_id','player_id'].sort());
        const [h,p]=r.body.token.split('.').slice(0,2).map(s=>JSON.parse(Buffer.from(s,'base64url')));assert.equal(h.alg,'HS256');assert.ok(p.exp-p.iat>=3600);
        assert.deepEqual((await call('/api/v1/me',r.body.token)).body,{role:r.body.role,user:r.body.user});
      }
      assert.equal((await call('/audit/v1/rbac/leagues/league-alpha-1/fixtures',tokens.organizer,{})).status,200);
      const matrix=await call('/audit/v1/rbac-matrix',null,{});assert.equal((await call('/api/v1/me',matrix.body.tokens.viewer)).status,200);
    });
    await t.test('bad credentials, missing and tampered tokens, and CORS',async()=>{
      for(const body of [{email:'viewer@nascon.test',password:'wrong'},{email:'nobody@nascon.test',password:'Nascon@26'},null,{email:{},password:[]}])assert.equal((await call('/api/v1/auth/login',null,body)).body.error.code,'UNAUTHENTICATED');
      assert.equal((await call('/api/v1/me')).status,401);
      assert.equal((await call('/api/v1/me',tokens.viewer.slice(0,-2)+'aa')).status,401);
      assert.equal((await call('/api/v1/me',tokens.viewer)).headers.get('access-control-allow-origin'),'*');
      const preflight=await fetch(base+'/api/v1/events',{method:'OPTIONS',headers:{Origin:'https://mobile.example','Access-Control-Request-Method':'POST'}});assert.equal(preflight.status,204);
      assert.deepEqual((await call('/api/v1/ping')).body,{pong:true});
    });
    await t.test('foreign clubs, leagues and matches are forbidden for every tenant role',async()=>{
      for(const role of ['organizer','manager','player','viewer'])for(const path of ['/clubs/club-beta-1','/leagues/league-beta-1/fixtures','/leagues/league-beta-1/standings','/matches/demo-match-beta-1']){
        const r=await call('/api/v1'+path,tokens[role]);assert.equal(r.status,403);assert.equal(r.body.error.code,'FORBIDDEN');
      }
      assert.equal((await call('/api/v1/clubs/club-beta-1',tokens.admin)).status,200);
      assert.equal((await call('/api/v1/clubs/missing',tokens.viewer)).status,404);
    });
    await t.test('startup and reset seed four teams, completed/live/upcoming fixtures, twelve players and store',async()=>{
      const verify=async()=>{
        const leagues=await call('/api/v1/leagues',tokens.viewer);assert.equal(leagues.status,200);assert.equal(leagues.body.leagues.length,2);assert.equal(leagues.body.leagues[0].teams.length,4);
        const fixtures=(await call('/api/v1/leagues/league-alpha-1/fixtures',tokens.viewer)).body.fixtures;assert.equal(fixtures.length,6);assert.equal(fixtures.filter(f=>f.status==='completed').length,2);assert.equal(fixtures.filter(f=>f.status==='in_progress').length,1);assert.equal(fixtures.filter(f=>f.status==='upcoming').length,3);
        const club=await call('/api/v1/clubs/club-alpha-1',tokens.viewer);assert.equal(club.body.roster.length,12);assert.ok(club.body.staff.length);assert.ok(club.body.home_venue.name);
        const products=(await call('/api/v1/products',tokens.viewer)).body.products;assert.equal(products[0].product_id,'prod-jersey-001');assert.equal(products[0].variants[0].price_minor,450000);
        assert.deepEqual((await call('/api/v1/matches/demo-match-alpha-3',tokens.viewer)).body,(await call('/audit/v1/score/demo-match-alpha-3')).body);
        assert.deepEqual((await call('/api/v1/leagues/league-alpha-1/standings',tokens.viewer)).body,(await call('/audit/v1/standings/league-alpha-1')).body);
      };
      await verify();await reset();await verify();
    });
    await t.test('GET sport detail returns exact stored mystery config for any authenticated role; unknown id is 404',async()=>{
      const initial=(await pool.query('SELECT config FROM sports ORDER BY sport_id LIMIT 1')).rows[0].config;
      const config={...initial,sport_id:'mobile-read-sport',name:'Mobile mystery config'};
      const created=await call('/audit/v1/sports',null,config);assert.equal(created.status,201);
      const stored=(await pool.query('SELECT config FROM sports WHERE sport_id=$1',[config.sport_id])).rows[0].config;
      for(const role of ['admin','organizer','manager','player','viewer']){const r=await call('/api/v1/sports/'+config.sport_id,tokens[role]);assert.equal(r.status,200);assert.deepEqual(r.body,stored);assert.deepEqual(Object.keys(r.body).sort(),['sport_id','name','scoring_model','periods','scoring_events','draw_allowed','overtime','tie_break_order','roster'].sort());}
      const missing=await call('/api/v1/sports/unknown-sport',tokens.viewer);assert.equal(missing.status,404);assert.equal(missing.body.error.code,'SPORT_NOT_FOUND');assert.equal((await call('/api/v1/sports/'+config.sport_id)).status,401);
    });
    await t.test('GET sports lists the exact saved configs for every authenticated role',async()=>{
      const expected=(await pool.query('SELECT config FROM sports ORDER BY sport_id')).rows.map(row=>row.config);assert.ok(expected.some(s=>s.sport_id==='mobile-read-sport'));
      for(const role of ['admin','organizer','manager','player','viewer']){const r=await call('/api/v1/sports',tokens[role]);assert.equal(r.status,200);assert.deepEqual(r.body,{sports:expected});}
      assert.equal((await call('/api/v1/sports')).status,401);
    });
    await t.test('only organizer can score owned league; cross-tenant and other league denied before mutation',async()=>{
      for(const role of ['viewer','manager','player'])assert.equal((await call('/api/v1/events',tokens[role],event('mobile-denied'))).status,403);
      assert.equal((await call('/api/v1/events',tokens.organizer,event('mobile-foreign','demo-match-beta-1'))).status,403);
      await pool.query('INSERT INTO matches VALUES ($1,$2)',['mobile-other-match',{league_id:'league-alpha-2',sport_id:'football',home_team_id:'team-alpha-5',away_team_id:'team-alpha-6'}]);
      assert.equal((await call('/api/v1/events',tokens.organizer,event('mobile-other','mobile-other-match'))).status,403);
      const request=event('mobile-start');const r=await call('/api/v1/events',tokens.organizer,request);assert.equal(r.status,201);assert.equal(r.body.signature,createSigner(process.env.DAY1_SALT)(request.event_id,request.payload));
      assert.equal((await call('/api/v1/events',tokens.organizer,request)).status,200);
      await reset();
    });
    await t.test('checkout wrapper binds customer, delegates receipt generation, replay and tenant isolation',async()=>{
      const body={order_id:'mobile-order',items:[{variant_id:'var-jersey-001-M',quantity:1}],payment:{token:'tok_success'}};
      assert.equal((await call('/api/v1/checkout',tokens.viewer,{...body,customer_id:'user-player'})).status,403);
      const r=await call('/api/v1/checkout',tokens.viewer,body);assert.equal(r.status,201);assert.ok(r.body.receipt.pdf_base64);assert.equal((await call('/api/v1/checkout',tokens.viewer,body)).status,200);
      assert.equal((await call('/api/v1/checkout',tokens.player,body)).status,409);
      await pool.query('INSERT INTO products VALUES ($1,$2)',['foreign-product','tenant-beta']);await pool.query('INSERT INTO variants VALUES ($1,$2,100,$3,1,0)',['foreign-variant','foreign-product','PKR']);
      assert.equal((await call('/api/v1/checkout',tokens.viewer,{...body,order_id:'foreign-order',items:[{variant_id:'foreign-variant',quantity:1}]})).status,403);
      await reset();
    });
    await t.test('offline scoring sorts timestamps, rebases stale versions, rejects future versions and skips duplicates',async()=>{
      const a=action('queue-start',event('queued-start')),b=action('queue-discipline',event('queued-discipline','demo-match-alpha-4','discipline',{team_id:'team-alpha-2',points:-1}),0,'score_event','2026-10-17T10:01:00Z'),c=action('queue-future',event('queued-future','demo-match-alpha-4','match_end'),99,'score_event','2026-10-17T10:02:00Z');
      const body={device_id:'mobile-device',actions:[b,a,c]},r=await call('/api/v1/offline-sync',tokens.organizer,body);assert.equal(r.status,200);assert.deepEqual(r.body.processed_order,['queue-start','queue-discipline','queue-future']);
      assert.deepEqual(r.body.results.map(r=>r.status),['applied','applied','rejected']);assert.equal(r.body.results[0].resolution,'rebased_append');assert.equal(r.body.results[2].error.code,'INVALID_BASE_VERSION');assert.equal(r.body.results[1].signature,createSigner(process.env.DAY1_SALT)('queued-start',{}));
      const replay=await call('/api/v1/offline-sync',tokens.organizer,body);assert.ok(replay.body.results.every(r=>r.status==='skipped_duplicate'));assert.equal((await call('/audit/v1/score/demo-match-alpha-4')).body.version,2);
      const forbidden={device_id:'mixed',actions:[action('allowed',event('mixed-allowed','demo-match-alpha-5')),action('foreign',event('mixed-foreign','demo-match-beta-1'))]};assert.equal((await call('/api/v1/offline-sync',tokens.organizer,forbidden)).status,403);assert.equal((await call('/audit/v1/score/demo-match-alpha-5')).body.version,0);
      assert.equal((await call('/api/v1/offline-sync',tokens.viewer,body)).status,403);
      assert.equal((await call('/api/v1/offline-sync',tokens.organizer,{device_id:'x',actions:[]})).status,400);
      await reset();
    });
    await t.test('concurrent duplicate sync burst uses one connection per request and appends exactly once',async()=>{
      const body={device_id:'burst-device',actions:[action('burst-start',event('burst-event','demo-match-alpha-6'))]};
      const requests=await Promise.all(Array.from({length:12},()=>call('/api/v1/offline-sync',tokens.organizer,body)));
      assert.ok(requests.every(r=>r.status===200));assert.equal(requests.filter(r=>r.body.results[0].status==='applied').length,1);assert.equal(requests.filter(r=>r.body.results[0].status==='skipped_duplicate').length,11);
      assert.equal((await call('/audit/v1/score/demo-match-alpha-6')).body.version,1);await reset();
    });
    await t.test('manager queue transfers own player; wrong roles and other clubs forbidden; replay is safe',async()=>{
      const payload={request_id:'mobile-transfer',league_id:'league-alpha-1',player_id:'demo-player-alpha-12',type:'transfer',from_squad_id:'squad-alpha-1',to_squad_id:'squad-alpha-2',effective_date:'2026-10-17',reason:'Mobile request'};
      const body={device_id:'manager-device',actions:[action('transfer-action',payload,0,'roster_action')]};
      assert.equal((await call('/api/v1/offline-sync',tokens.organizer,body)).status,403);
      assert.equal((await call('/api/v1/offline-sync',tokens.manager,{...body,actions:[action('wrong-club',{...payload,from_squad_id:'squad-alpha-2',to_squad_id:'squad-alpha-1'},0,'roster_action')]})).status,403);
      const r=await call('/api/v1/offline-sync',tokens.manager,body);assert.equal(r.status,200);assert.equal(r.body.results[0].status,'applied');assert.equal(r.body.results[0].server_version,1);
      assert.equal((await call('/api/v1/clubs/club-alpha-1',tokens.viewer)).body.roster.length,11);assert.equal((await call('/api/v1/clubs/club-alpha-2',tokens.viewer)).body.roster.length,2);
      assert.equal((await call('/api/v1/offline-sync',tokens.manager,body)).body.results[0].status,'skipped_duplicate');
      await reset();assert.equal((await call('/api/v1/clubs/club-alpha-1',tokens.viewer)).body.roster.length,12);
    });
  }finally{await reset();await pool.end();}
});
