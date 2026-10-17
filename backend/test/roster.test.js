import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:8080';
const post=async(path,body)=>{const r=await fetch(base+'/audit/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
const history=async(player='rp2',date='2026-09-30')=>{const r=await fetch(`${base}/audit/v1/roster/history/${encodeURIComponent(player)}?as_of=${date}`);return {status:r.status,body:await r.json()};};
const scenario=()=>({league:{league_id:'lg-roster',tenant_id:'tenant-alpha',sport_id:'roster-mystery',transfer_window:{open:'2026-09-01',close:'2026-09-30'}},squads:[['sq-a','tenant-alpha'],['sq-b','tenant-alpha'],['sq-c','tenant-alpha'],['sq-f','tenant-beta'],['sq-g','tenant-beta']].map(([squad_id,tenant_id])=>({squad_id,tenant_id,club_id:'club-'+squad_id,name:squad_id})),players:[['rp1','anchor','sq-a','captain'],['rp2','wing','sq-a','vice_captain'],['rp3','wing','sq-a','starter'],['rp4','anchor','sq-b','captain'],['rp5','wing','sq-b','substitute'],['rp6','anchor','sq-c','starter']].map(([player_id,position,squad_id,role])=>({player_id,position,squad_id,role,name:player_id})),matches_in_progress:[]});
let sequence=0;
const request=(overrides={})=>({request_id:`rtr-${++sequence}`,league_id:'lg-roster',player_id:'rp2',type:'transfer',from_squad_id:'sq-a',to_squad_id:'sq-b',effective_date:'2026-09-30',loan_end_date:null,reason:'A roster change',requested_by:'user-77',...overrides});
const check=(result,status,code)=>{assert.equal(result.status,status,JSON.stringify(result.body));if(code){assert.equal(result.body.error.code,code);if(status===400)assert.ok(result.body.error.details.fields.length);}};

test('Section 5.11 exact roster contract, ordered rules, immutable history and concurrency',{skip:process.env.RUN_INTEGRATION!=='1',timeout:120000},async t=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const setup=async(s=scenario())=>{const r=await post('roster/setup',s);check(r,201);return r;};
  const snapshot=async()=>{const out={};for(const table of ['rosters','roster_history','roster_requests','players'])out[table]=(await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;out.roster_audit_seq=(await pool.query('SELECT last_value,is_called FROM roster_audit_seq')).rows;return out;};
  const rejected=async(body,status,code)=>{const before=await snapshot();check(await post('roster/transfer',body),status,code);assert.deepEqual(await snapshot(),before,'Rejected change writes no state, history, or idempotency record');};
  try {
    await post('reset',{});
    check(await post('sports',{sport_id:'roster-mystery',name:'Mystery roster sport',scoring_model:'event',periods:{count:2,duration_minutes:9},scoring_events:{pulse:{points:1}},draw_allowed:true,overtime:{policy:'none'},roster:{min_squad_size:1,max_squad_size:3,required_positions:{anchor:1}}}),201);
    await t.test('setup exact response; ordinary mystery-sport defaults; all four roles; validation before references',async()=>{
      const r=await setup();assert.deepEqual(r.body,{league_id:'lg-roster',status:'configured',squad_counts:{'sq-a':3,'sq-b':2,'sq-c':1,'sq-f':0,'sq-g':0}});
      const stored=(await pool.query('SELECT data FROM rosters WHERE roster_id=$1',['lg-roster'])).rows[0].data;
      assert.equal(stored.league.max_squad_size,3);assert.deepEqual(stored.league.required_positions,{anchor:1});
      assert.deepEqual(new Set(stored.players.map(p=>p.role)),new Set(['captain','vice_captain','starter','substitute']));
      const bad=scenario();bad.league.sport_id='missing';bad.players[0].role='invalid';check(await post('roster/setup',bad),400,'VALIDATION_ERROR');
      bad.players[0].role='captain';check(await post('roster/setup',bad),404,'SPORT_NOT_FOUND');
      const ref=scenario();ref.players[0].squad_id='missing';check(await post('roster/setup',ref),404,'SQUAD_NOT_FOUND');
      const override=scenario();override.league.max_squad_size=7;override.league.required_positions={};await setup(override);assert.equal((await pool.query('SELECT data FROM rosters WHERE roster_id=$1',['lg-roster'])).rows[0].data.league.max_squad_size,7);
    });
    await t.test('rule 1: malformed schema, calendar dates, loan end and release target take precedence',async()=>{
      await setup();
      for(const change of [null,[],{},request({effective_date:'2026-02-30',league_id:'missing'}),request({type:'loan',loan_end_date:'2026-09-30'}),request({type:'loan',loan_end_date:'2026-09-29'}),request({type:'loan',loan_end_date:null}),request({to_squad_id:null}),request({type:'release',to_squad_id:'sq-b'}),request({loan_end_date:'not-a-date'}),request({requested_by:null}),request({reason:3}),request({type:'other'}),request({from_squad_id:'bad|id'}),request({player_id:'bad|id'})])await rejected(change,400,'VALIDATION_ERROR');
    });
    await t.test('rule 2: league then player then squad existence wins before business rules',async()=>{
      await setup();await rejected(request({league_id:'missing',player_id:'missing',to_squad_id:'missing'}),404,'LEAGUE_NOT_FOUND');
      await rejected(request({player_id:'missing',to_squad_id:'missing'}),404,'PLAYER_NOT_FOUND');
      await rejected(request({from_squad_id:'sq-f',to_squad_id:'missing'}),404,'SQUAD_NOT_FOUND');
      await rejected(request({from_squad_id:'missing',effective_date:'2026-10-01'}),404,'SQUAD_NOT_FOUND');
    });
    await t.test('rule 3: BOTH squads must match league tenant, before membership/window/capacity',async()=>{
      await setup();await rejected(request({to_squad_id:'sq-f',effective_date:'2026-10-01'}),409,'CROSS_TENANT_TRANSFER');
      await rejected(request({from_squad_id:'sq-f',to_squad_id:'sq-g'}),409,'CROSS_TENANT_TRANSFER');
      await rejected(request({type:'release',from_squad_id:'sq-f',to_squad_id:null}),409,'CROSS_TENANT_TRANSFER');
    });
    await t.test('rule 4: wrong membership beats closed window',async()=>{
      await setup();await rejected(request({from_squad_id:'sq-c',effective_date:'2026-10-01'}),409,'NOT_IN_SQUAD');
    });
    await t.test('rule 5: closed window beats loan/full; both boundary dates inclusive; release any date',async()=>{
      await setup();check(await post('roster/transfer',request({type:'loan',effective_date:'2026-09-10',loan_end_date:'2026-10-10'})),201);
      await rejected(request({from_squad_id:'sq-b',to_squad_id:'sq-a',effective_date:'2026-10-01'}),409,'TRANSFER_WINDOW_CLOSED');
      for(const date of ['2026-09-01','2026-09-30']){await setup();check(await post('roster/transfer',request({effective_date:date})),201);}
      await setup();const release=await post('roster/transfer',request({type:'release',to_squad_id:null,effective_date:'2027-01-05'}));check(release,201);assert.equal(release.body.registration,null);assert.equal((await history('rp2','2027-01-05')).body.current_squad_id,null);
    });
    await t.test('rule 6: loaned player cannot transfer, loan or release; precedes full destination',async()=>{
      const s=scenario();s.players.push({player_id:'rp7',name:'Seven',position:'wing',squad_id:'sq-c',role:'starter'},{player_id:'rp8',name:'Eight',position:'wing',squad_id:'sq-c',role:'starter'});await setup(s);
      check(await post('roster/transfer',request({type:'loan',effective_date:'2026-09-10',loan_end_date:'2026-10-10'})),201);
      for(const type of ['transfer','loan','release'])await rejected(request({type,from_squad_id:'sq-b',to_squad_id:type==='release'?null:'sq-c',effective_date:type==='release'?'2026-10-01':'2026-09-11',loan_end_date:type==='loan'?'2026-09-20':null}),409,'PLAYER_ON_LOAN');
    });
    await t.test('rule 7 beats rule 8; rule 8 protects source position even for release',async()=>{
      const s=scenario();s.players.push({player_id:'rp7',name:'Seven',position:'wing',squad_id:'sq-b',role:'starter'});await setup(s);
      await rejected(request({player_id:'rp1'}),409,'SQUAD_FULL');
      await setup();await rejected(request({player_id:'rp1'}),409,'MIN_POSITION_VIOLATION');await rejected(request({player_id:'rp1',type:'release',to_squad_id:null,effective_date:'2027-02-01'}),409,'MIN_POSITION_VIOLATION');
    });
    await t.test('exact accepted registration/audit, role vacancy, replay after later changes and historical dates',async()=>{
      await setup();const body=request(),r=await post('roster/transfer',{...body,ignored:'not identity'});check(r,201);
      assert.deepEqual(Object.keys(r.body).sort(),['request_id','status','state','blocking_match_id','registration','audit_entry'].sort());
      assert.equal(r.body.status,'accepted');assert.equal(r.body.state,'active');assert.equal(r.body.blocking_match_id,null);
      assert.deepEqual(r.body.registration,{player_id:'rp2',league_id:'lg-roster',squad_id:'sq-b',parent_squad_id:null,registration_type:'transfer',start_date:'2026-09-30',loan_end_date:null,role:'substitute'});
      const a=r.body.audit_entry;assert.match(a.audit_id,/^au-\d{4,}$/);assert.equal(BigInt(a.audit_id.slice(3)),BigInt((await pool.query('SELECT last_value FROM roster_audit_seq')).rows[0].last_value));assert.deepEqual(Object.keys(a).sort(),['audit_id','action','player_id','league_id','from_squad_id','to_squad_id','effective_date','state','who','when','why'].sort());assert.equal(a.who,'user-77');assert.equal(a.why,body.reason);assert.match(a.when,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      const stored=(await pool.query('SELECT data FROM rosters WHERE roster_id=$1',['lg-roster'])).rows[0].data;assert.ok(!stored.players.some(p=>p.squad_id==='sq-a'&&p.role==='vice_captain'));
      check(await post('roster/transfer',request({from_squad_id:'sq-b',to_squad_id:null,type:'release',effective_date:'2027-01-05'})),201);
      const before=await snapshot(),replay=await post('roster/transfer',body);check(replay,200);assert.deepEqual(replay.body,r.body);assert.deepEqual(await snapshot(),before);
      assert.equal((await history('rp2','2026-09-29')).body.current_squad_id,'sq-a');assert.equal((await history('rp2','2026-09-30')).body.current_squad_id,'sq-b');
      assert.equal((await history('rp2','2027-01-05')).body.current_squad_id,null);
    });
    await t.test('edge case 6: last window day accepted, exact deferred state, old live-match eligibility retained',async()=>{
      const s=scenario();s.matches_in_progress=[{match_id:'m-live',home_squad_id:'sq-a',away_squad_id:'sq-b'}];await setup(s);
      const r=await post('roster/transfer',request());check(r,201);assert.equal(r.body.state,'deferred_until_match_end');assert.equal(r.body.blocking_match_id,'m-live');assert.equal(r.body.registration.squad_id,'sq-b');assert.equal(r.body.audit_entry.state,r.body.state);
      const saved=(await pool.query('SELECT data FROM rosters WHERE roster_id=$1',['lg-roster'])).rows[0].data;assert.deepEqual(saved.match_eligibility['m-live'].rp2,{squad_id:'sq-a',role:'vice_captain'});
    });
    await t.test('hostile text is parameterized and object-key ids preserve live-match eligibility safely',async()=>{
      const s=scenario();s.players[1].player_id='constructor';s.matches_in_progress=[{match_id:'__proto__',home_squad_id:'sq-a',away_squad_id:'sq-b'}];await setup(s);
      const r=await post('roster/transfer',request({player_id:'constructor',reason:"'; DROP TABLE players; -- <svg>"}));check(r,201);assert.equal(r.body.audit_entry.why,"'; DROP TABLE players; -- <svg>");
      const saved=(await pool.query('SELECT data FROM rosters WHERE roster_id=$1',['lg-roster'])).rows[0].data;assert.ok(Object.hasOwn(saved.match_eligibility,'__proto__'));assert.deepEqual(saved.match_eligibility.__proto__.constructor,{squad_id:'sq-a',role:'vice_captain'});check(await history('constructor'),200);
    });
    await t.test('loan inclusive ownership; twenty concurrent history reads append one system return, never duplicates',async()=>{
      await setup();const r=await post('roster/transfer',request({type:'loan',effective_date:'2026-09-10',loan_end_date:'2026-09-20'}));check(r,201);assert.equal(r.body.registration.parent_squad_id,'sq-a');assert.equal(r.body.registration.registration_type,'loan');
      for(const date of ['2026-09-10','2026-09-20']){const h=await history('rp2',date);check(h,200);assert.equal(h.body.current_squad_id,'sq-b');assert.equal(h.body.parent_squad_id,'sq-a');assert.equal(h.body.history.length,1);}
      assert.equal((await history('rp2','2026-09-09')).body.current_squad_id,'sq-a');
      const reads=await Promise.all(Array.from({length:20},()=>history('rp2','2026-09-21')));for(const h of reads){check(h,200);assert.equal(h.body.current_squad_id,'sq-a');assert.equal(h.body.parent_squad_id,null);assert.deepEqual(h.body.history.map(a=>a.action),['loan','loan_return']);assert.equal(h.body.history[1].who,'system');assert.equal(h.body.history[1].effective_date,'2026-09-21');}
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM roster_history WHERE league_id=$1 AND data->'audit_entry'->>'action'='loan_return'",['lg-roster'])).rows[0].n,1);
      assert.equal((await history('rp2','2026-09-20')).body.current_squad_id,'sq-b');assert.equal((await history('rp2','2026-09-21')).body.history.length,2);
      const saved=(await pool.query('SELECT data FROM rosters WHERE roster_id=$1',['lg-roster'])).rows[0].data;assert.equal(saved.players.find(p=>p.player_id==='rp2').role,'substitute');
    });
    await t.test('late return materialization never overwrites a subsequent transfer on the return date',async()=>{
      await setup();check(await post('roster/transfer',request({type:'loan',effective_date:'2026-09-10',loan_end_date:'2026-09-20'})),201);
      check(await post('roster/transfer',request({to_squad_id:'sq-c',effective_date:'2026-09-21'})),201);
      const h=await history('rp2','2026-09-21');check(h,200);assert.equal(h.body.current_squad_id,'sq-c');assert.equal(h.body.history.filter(e=>e.action==='loan_return').length,1);
    });
    await t.test('twenty simultaneous transfers into one free slot: one accepted, nineteen SQUAD_FULL',async()=>{
      const s=scenario();s.league.required_positions={};s.players=s.players.filter(p=>p.squad_id==='sq-b');s.squads=s.squads.filter(q=>q.squad_id==='sq-b');
      for(let i=0;i<20;i++){s.squads.push({squad_id:`source-${i}`,club_id:`club-source-${i}`,tenant_id:'tenant-alpha',name:'Source'});s.players.push({player_id:`buyer-${i}`,position:'wing',squad_id:`source-${i}`,name:'Buyer',role:'starter'});}await setup(s);
      const burst=await Promise.all(Array.from({length:20},(_,i)=>post('roster/transfer',request({player_id:`buyer-${i}`,from_squad_id:`source-${i}`}))));assert.equal(burst.filter(r=>r.status===201).length,1);assert.equal(burst.filter(r=>r.status===409&&r.body.error.code==='SQUAD_FULL').length,19);
      const saved=(await pool.query('SELECT data FROM rosters WHERE roster_id=$1',['lg-roster'])).rows[0].data;assert.equal(saved.players.filter(p=>p.squad_id==='sq-b').length,3);t.diagnostic('20 concurrent roster requests: 1 accepted, 19 SQUAD_FULL, destination count 3');
    });
    await t.test('Postgres audit sequence is global across players and setup replacements, replay allocates no id',async()=>{
      await setup();const a=await post('roster/transfer',request());check(a,201);await setup();const body=request({player_id:'rp3'}),b=await post('roster/transfer',body);check(b,201);
      assert.equal(BigInt(b.body.audit_entry.audit_id.slice(3)),BigInt(a.body.audit_entry.audit_id.slice(3))+1n);
      const before=(await pool.query('SELECT last_value,is_called FROM roster_audit_seq')).rows;check(await post('roster/transfer',body),200);assert.deepEqual((await pool.query('SELECT last_value,is_called FROM roster_audit_seq')).rows,before);
    });
    await t.test('setup replacement isolates history without UPDATE/DELETE; reset clears custom state and caches',async()=>{
      await setup();check(await post('roster/transfer',request()),201);const count=(await pool.query('SELECT * FROM roster_history')).rowCount;await setup();assert.equal((await history()).body.history.length,0);assert.equal((await pool.query('SELECT * FROM roster_history')).rowCount,count);
      await assert.rejects(pool.query("UPDATE roster_history SET data='{}'"),/append-only/);await assert.rejects(pool.query('DELETE FROM roster_history'),/append-only/);
      check(await history('missing'),404,'PLAYER_NOT_FOUND');check(await history('rp2','2026-02-30'),400,'VALIDATION_ERROR');
      await post('reset',{});for(const table of ['roster_history','roster_requests','offline_sync'])assert.equal((await pool.query(`SELECT * FROM ${table}`)).rowCount,0);assert.equal((await pool.query('SELECT * FROM rosters WHERE roster_id=$1',['lg-roster'])).rowCount,0);
    });
  }finally{await post('reset',{});await pool.end();}
});

