import pg from 'pg';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSigner} from '../src/signature.js';
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:8080';
const post=async(path,body)=>{const r=await fetch(base+'/audit/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
const action=(action_id,type,payload,base_version,minute)=>({action_id,type,payload,base_version,queued_at:`2026-10-17T10:${String(minute).padStart(2,'0')}:00Z`});
test('Section 5.14 audit offline sync uses scoring and roster domain services with exact conflict results',{skip:process.env.RUN_INTEGRATION!=='1'},async t=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const snapshot=async()=>{const state={};for(const table of ['matches','events','rosters','roster_history','roster_requests','offline_sync'])state[table]=(await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;state.roster_audit_seq=(await pool.query('SELECT last_value,is_called FROM roster_audit_seq')).rows;return state;};
  try{
    const reset=await post('reset',{}),sport_id=reset.body.sports[0];
    const scenario={league:{league_id:'offline-league',tenant_id:'tenant-alpha',sport_id,transfer_window:{open:'2026-09-01',close:'2026-09-30'},max_squad_size:2,required_positions:{}},squads:['a','b'].map(id=>({squad_id:`off-${id}`,club_id:`off-club-${id}`,tenant_id:'tenant-alpha',name:id})),players:[['off-p1','off-a'],['off-p2','off-b'],['off-p3','off-b']].map(([player_id,squad_id])=>({player_id,squad_id,name:player_id,position:'generic',role:'starter'})),matches_in_progress:[]};
    assert.equal((await post('roster/setup',scenario)).status,201);
    await t.test('only malformed envelopes fail the whole request',async()=>{
      const valid=action('x','score_event',{},0,0);
      for(const body of [null,[],{}, {device_id:'dev',actions:[]},{device_id:'dev',actions:Array.from({length:101},(_,i)=>({...valid,action_id:`x${i}`}))},{device_id:'bad|id',actions:[valid]},{device_id:'dev',actions:[{...valid,type:'roster_action'}]},{device_id:'dev',actions:[{...valid,queued_at:'2026-02-30T10:00:00Z'}]},{device_id:'dev',actions:[{...valid,base_version:-1}]},{device_id:'dev',actions:[valid,valid]}]){const r=await post('offline-sync',body);assert.equal(r.status,400);assert.equal(r.body.error.code,'VALIDATION_ERROR');assert.ok(r.body.error.details.fields.length);}
    });
    await t.test('sorted processing, every resolution, shared roster errors, signatures and replay counts',async()=>{
      const m='demo-match-alpha-4',score=await(await fetch(base+'/audit/v1/score/'+m)).json();
      const start={event_id:'offline-start',match_id:m,type:'match_start',payload:{}},discipline={event_id:'offline-discipline',match_id:m,type:'discipline',payload:{team_id:score.home.team_id,points:-1}};
      const roster={request_id:'offline-roster',league_id:'offline-league',player_id:'off-p1',type:'transfer',from_squad_id:'off-a',to_squad_id:'off-b',effective_date:'2026-09-30',loan_end_date:null,requested_by:'offline-user',reason:'Queued change'};
      const actions=[action('start','score_event',start,0,0),action('stale','score_event',discipline,0,1),action('future','score_event',{event_id:'offline-future',match_id:m,type:'match_end',payload:{}},99,2),action('unknown','score_event',{...start,event_id:'offline-unknown',match_id:'missing'},0,3),action('full','roster_transfer',roster,0,4),action('duplicate','score_event',start,0,5),action('changed','score_event',{...start,payload:{extra:true}},0,6),action('missing-player','roster_transfer',{...roster,request_id:'off-missing',player_id:'missing'},99,7),action('release','roster_transfer',{...roster,request_id:'off-release',type:'release',to_squad_id:null,effective_date:'2027-01-01'},0,8),action('invalid-payload','roster_transfer',{},0,9)];
      const body={device_id:'audit-device',actions:[...actions].reverse()},r=await post('offline-sync',body);assert.equal(r.status,200);assert.deepEqual(Object.keys(r.body).sort(),['device_id','results','summary']);assert.deepEqual(r.body.summary,{applied:3,rejected:6,duplicate:1});
      const byId=new Map(r.body.results.map(result=>[result.action_id,result]));assert.deepEqual(r.body.results.map(result=>result.action_id),body.actions.map(a=>a.action_id));
      for(const [i,a]of actions.entries()){const result=byId.get(a.action_id);assert.equal(result.processed_order,i+1);assert.deepEqual(Object.keys(result).sort(),['action_id','status','resolution','error_code','processed_order','server_version','signature'].sort());}
      assert.equal(byId.get('start').resolution,'appended');assert.equal(byId.get('start').server_version,1);assert.equal(byId.get('start').signature,createSigner(process.env.DAY1_SALT)(start.event_id,start.payload));
      assert.equal(byId.get('stale').resolution,'rebased_append');assert.equal(byId.get('stale').server_version,2);assert.equal(byId.get('stale').signature,createSigner(process.env.DAY1_SALT)(discipline.event_id,discipline.payload));
      for(const [id,code]of [['future','INVALID_BASE_VERSION'],['unknown','MATCH_NOT_FOUND'],['full','SQUAD_FULL'],['changed','DUPLICATE_EVENT_ID'],['missing-player','PLAYER_NOT_FOUND'],['invalid-payload','VALIDATION_ERROR']]){assert.equal(byId.get(id).status,'rejected');assert.equal(byId.get(id).resolution,'server_wins');assert.equal(byId.get(id).error_code,code);assert.equal(byId.get(id).signature,null);}
      assert.equal(byId.get('duplicate').status,'duplicate');assert.equal(byId.get('duplicate').resolution,'skipped_duplicate');assert.equal(byId.get('duplicate').server_version,2);assert.equal(byId.get('duplicate').signature,null);
      assert.equal(byId.get('release').status,'applied');assert.equal(byId.get('release').server_version,1);assert.equal(byId.get('release').signature,null);
      const beforeReplay=await snapshot();
      const replay=await post('offline-sync',body);assert.equal(replay.status,200);assert.deepEqual(replay.body.summary,{applied:0,rejected:0,duplicate:10});assert.ok(replay.body.results.every(r=>r.status==='duplicate'&&r.resolution==='skipped_duplicate'&&r.error_code===null&&r.signature===null));
      assert.deepEqual(await snapshot(),beforeReplay,'Full replay changes neither domain data, audit ids, nor processed-action records');
      assert.equal((await(await fetch(base+'/audit/v1/score/'+m)).json()).version,2);
      const h=await(await fetch(base+'/audit/v1/roster/history/off-p1?as_of=2027-01-01')).json();assert.equal(h.history.length,1);assert.equal(h.history[0].who,'offline-user');assert.equal(h.current_squad_id,null);
    });
    await t.test('same timestamp preserves input order and versions come from preceding actions',async()=>{
      const actions=[action('start-tied','score_event',{event_id:'off-tied-start',match_id:'demo-match-alpha-5',type:'match_start',payload:{}},0,0),action('end-tied','score_event',{event_id:'off-tied-end',match_id:'demo-match-alpha-5',type:'match_end',payload:{}},1,0)];
      const r=await post('offline-sync',{device_id:'tied-device',actions});assert.equal(r.status,200);assert.deepEqual(r.body.summary,{applied:2,rejected:0,duplicate:0});assert.deepEqual(r.body.results.map(r=>r.processed_order),[1,2]);assert.deepEqual(r.body.results.map(r=>r.server_version),[1,2]);
    });
    await t.test('roster current/stale/future versions count audit entries, including automatic loan returns',async()=>{
      const s=structuredClone(scenario);s.league.max_squad_size=4;assert.equal((await post('roster/setup',s)).status,201);
      const roster=(id,from,to,date,extras={})=>({request_id:id,league_id:'offline-league',player_id:'off-p1',type:'transfer',from_squad_id:from,to_squad_id:to,effective_date:date,loan_end_date:null,requested_by:'offline-user',reason:'Version test',...extras});
      const loan=roster('version-loan','off-a','off-b','2026-09-10',{type:'loan',loan_end_date:'2026-09-20'});
      const actions=[action('roster-equal','roster_transfer',roster('version-first','off-a','off-b','2026-09-01'),0,10),action('roster-stale','roster_transfer',roster('version-second','off-b','off-a','2026-09-02'),0,11),action('roster-future','roster_transfer',roster('version-future','off-a','off-b','2026-09-03'),99,12),action('roster-loan','roster_transfer',loan,2,13)];
      const r=await post('offline-sync',{device_id:'roster-versions',actions});assert.equal(r.status,200);assert.deepEqual(r.body.summary,{applied:3,rejected:1,duplicate:0});assert.deepEqual(r.body.results.map(r=>r.server_version),[1,2,2,3]);assert.deepEqual(r.body.results.map(r=>r.resolution),['appended','rebased_append','server_wins','appended']);assert.equal(r.body.results[2].error_code,'INVALID_BASE_VERSION');assert.ok(r.body.results.every(r=>r.signature===null));
      const h=await(await fetch(base+'/audit/v1/roster/history/off-p1?as_of=2026-09-21')).json();assert.equal(h.history.length,4);assert.equal(h.history.at(-1).action,'loan_return');
      const after=roster('version-after-return','off-a','off-b','2026-09-21'),next=await post('offline-sync',{device_id:'after-return',actions:[action('after-return','roster_transfer',after,3,14)]});assert.equal(next.status,200);assert.equal(next.body.results[0].server_version,5);assert.equal(next.body.results[0].resolution,'rebased_append');
      const duplicate=await post('offline-sync',{device_id:'new-device',actions:[action('new-action-same-request','roster_transfer',after,99,15)]});assert.equal(duplicate.body.results[0].status,'duplicate');assert.equal(duplicate.body.results[0].server_version,5);
    });
    await t.test('each unknown reference and scoring rule rejects per action without changing the domain',async()=>{
      const roster={request_id:'rule-check',league_id:'offline-league',player_id:'off-p1',type:'transfer',from_squad_id:'off-b',to_squad_id:'off-a',effective_date:'2026-09-22',loan_end_date:null,requested_by:'offline-user',reason:'Missing references'};
      const match='demo-match-alpha-1',score=await(await fetch(base+'/audit/v1/score/'+match)).json();
      const cases=[['missing-league','roster_transfer',{...roster,league_id:'missing'},'LEAGUE_NOT_FOUND'],['missing-player-2','roster_transfer',{...roster,player_id:'missing'},'PLAYER_NOT_FOUND'],['missing-squad','roster_transfer',{...roster,to_squad_id:'missing'},'SQUAD_NOT_FOUND'],['not-progress','score_event',{event_id:'off-not-progress',match_id:match,type:'discipline',payload:{team_id:score.home.team_id,points:-1}},'MATCH_NOT_IN_PROGRESS'],['invalid-comp','score_event',{event_id:'off-invalid-comp',match_id:match,type:'compensation',payload:{compensates:score.events[0].event_id,reason:'Invalid target'}},'INVALID_COMPENSATION'],['missing-event','score_event',{event_id:'off-missing-event',match_id:match,type:'compensation',payload:{compensates:'missing-event',reason:'Missing target'}},'EVENT_NOT_FOUND']];
      const before=await snapshot(),r=await post('offline-sync',{device_id:'rule-checks',actions:cases.map(([id,type,payload],i)=>action(id,type,payload,0,i))});assert.equal(r.status,200);assert.deepEqual(r.body.summary,{applied:0,rejected:6,duplicate:0});
      for(const [i,result]of r.body.results.entries()){assert.equal(result.status,'rejected');assert.equal(result.resolution,'server_wins');assert.equal(result.error_code,cases[i][3]);assert.equal(result.signature,null);}
      const after=await snapshot();delete before.offline_sync;delete after.offline_sync;assert.deepEqual(after,before,'Rejected actions only record their processed ids');
    });
    await t.test('direct online event is duplicate on another device; duplicate action retains original affected version',async()=>{
      const event={event_id:'off-direct-start',match_id:'demo-match-alpha-6',type:'match_start',payload:{}};assert.equal((await post('events',event)).status,201);
      const a=action('direct-duplicate','score_event',event,99,0),r=await post('offline-sync',{device_id:'direct-device',actions:[a]});assert.equal(r.status,200);assert.equal(r.body.results[0].status,'duplicate');assert.equal(r.body.results[0].resolution,'skipped_duplicate');assert.equal(r.body.results[0].server_version,1);assert.equal(r.body.results[0].signature,null);
      const changed=await post('offline-sync',{device_id:'direct-device',actions:[{...a,payload:{...event,event_id:'different',match_id:'missing'}}]});assert.equal(changed.status,200);assert.equal(changed.body.results[0].status,'duplicate');assert.equal(changed.body.results[0].server_version,1);
    });
    await t.test('100 actions accepted and a complete replay is 100 duplicates, with no audit rate limit',async()=>{
      const body={device_id:'hundred-actions',actions:Array.from({length:100},(_,i)=>action(`hundred-${i}`,'score_event',{event_id:`hundred-event-${i}`,match_id:'missing',type:'match_start',payload:{}},0,0))};
      const first=await post('offline-sync',body);assert.equal(first.status,200);assert.deepEqual(first.body.summary,{applied:0,rejected:100,duplicate:0});assert.ok(first.body.results.every(r=>r.error_code==='MATCH_NOT_FOUND'));
      const before=await snapshot(),replay=await post('offline-sync',body);assert.equal(replay.status,200);assert.deepEqual(replay.body.summary,{applied:0,rejected:0,duplicate:100});assert.deepEqual(await snapshot(),before);
    });
  }finally{await post('reset',{});await pool.end();}
});
