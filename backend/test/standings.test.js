import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:8080';
const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const get=async league=>{const response=await fetch(`${base}/audit/v1/standings/${encodeURIComponent(league)}`);assert.equal(response.status,200);return response.json();};
const config=(model='event')=>({sport_id:`table-${model}`,name:`Table ${model}`,scoring_model:model,periods:model==='event'?{count:1,duration_minutes:1}:model==='round'?{best_of:5}:{innings_per_team:1,overs_per_innings:2,balls_per_over:3,wickets_per_innings:2},scoring_events:model==='event'?{tick:{points:1}}:model==='round'?{map:{rounds:1}}:{hit:{runs:3,legal_ball:true,wicket:false},idle:{runs:0,legal_ball:true,wicket:false},removed:{runs:0,legal_ball:true,wicket:true}},draw_allowed:false,overtime:{policy:'shootout'},roster:{min_squad_size:1,max_squad_size:10,required_positions:{}}});
const league=(id,teams=['a','b'],fixtures=[],extra={})=>({league_id:id,sport_id:'table-event',teams,fixtures,qualification:{spots:1},...extra});
const fixture=(match_id,home,away)=>({match_id,home,away});
async function error(response,status,code){assert.equal(response.status,status);const body=await response.json();assert.equal(body.error.code,code);assert.equal(typeof body.error.message,'string');assert.ok(body.error.details&&!Array.isArray(body.error.details));return body.error.details;}
test('Sections 5.8 and 5.10 live league and standings contract',{skip:process.env.RUN_INTEGRATION!=='1'},async t=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});let counter=0;
  const event=async(match_id,type,payload={})=>{const event_id=`table-evt-${++counter}`,response=await post('/audit/v1/events',{event_id,match_id,type,payload});assert.equal(response.status,201,JSON.stringify(await response.clone().json()));return event_id;};
  const reset=async(seed=42)=>{assert.equal((await post('/audit/v1/reset',{seed})).status,200);for(const model of ['event','innings','round'])assert.equal((await post('/audit/v1/sports',config(model))).status,201);};
  const register=async body=>{const response=await post('/audit/v1/leagues',body);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));assert.deepEqual(await response.json(),{league_id:body.league_id,status:'created',team_count:body.teams.length,fixture_count:body.fixtures.length});};
  const finish=async(match,home,away,counts=[0,0],fair=[0,0])=>{await event(match,'match_start');const ids=[];for(const [i,team]of [home,away].entries()){for(let n=0;n<counts[i];n++)ids.push(await event(match,'score',{team_id:team,event_type:'tick'}));if(fair[i])await event(match,'discipline',{team_id:team,points:fair[i]});}await event(match,'match_end');return ids;};
  try{
    await t.test('validation, references, defaults and fixture streams',async()=>{
      await reset(17);
      const valid=league('defaults',['a','b'],[fixture('defaults-match','a','b')]);
      const invalid=[null,[],{}, {...valid,league_id:'bad|id'}, {...valid,teams:['a','a']}, {...valid,teams:['a']}, {...valid,teams:Array.from({length:41},(_,i)=>`x${i}`)}, {...valid,fixtures:[fixture('bad','a','outside')]}, {...valid,fixtures:[fixture('bad','a','a')]}, {...valid,fixtures:[fixture('dup','a','b'),fixture('dup','b','a')]}, {...valid,qualification:{spots:0}}, {...valid,qualification:{spots:3}}, {...valid,qualification:null}, {...valid,points:null}, {...valid,points:{win:1.5}}, {...valid,tie_break_order:['scored','scored']}, {...valid,tie_break_order:['bad']}, {...valid,lots_seed:'42'}];
      for(const body of invalid){const details=await error(await post('/audit/v1/leagues',body),400,'VALIDATION_ERROR');assert.ok(details.fields.length);}
      await error(await post('/audit/v1/leagues',{...valid,sport_id:'missing'}),404,'SPORT_NOT_FOUND');
      await register(valid);
      const stored=(await pool.query('SELECT config FROM leagues WHERE league_id=$1',['defaults'])).rows[0].config;
      assert.equal(stored.lots_seed,17);assert.deepEqual(stored.points,{win:3,draw:1,loss:0});assert.deepEqual(stored.tie_break_order,['h2h_points','h2h_diff','overall_diff','scored','fair_play','draw_lots']);
      const initial=await (await fetch(base+'/audit/v1/score/defaults-match')).json();assert.equal(initial.status,'upcoming');assert.equal(initial.version,0);assert.equal(initial.league_id,'defaults');
      await error(await post('/audit/v1/events',{event_id:'existing-init',match_id:'defaults-match',type:'match_init',payload:{sport_id:'table-event',home_team_id:'a',away_team_id:'b'}}),409,'MATCH_EXISTS');
      await event('defaults-match','match_start');assert.equal((await (await fetch(base+'/audit/v1/score/defaults-match')).json()).version,1);
      await register(league('override',['a','b'],[],{lots_seed:-3,points:{win:7},tie_break_order:['draw_lots','fair_play']}));
      const override=(await pool.query('SELECT config FROM leagues WHERE league_id=$1',['override'])).rows[0].config;assert.equal(override.lots_seed,-3);assert.deepEqual(override.points,{win:7,draw:1,loss:0});assert.deepEqual(override.tie_break_order,['fair_play','draw_lots']);
    });
    await t.test('conflicts are atomic, including concurrent league and fixture ids',async()=>{
      await reset();await register(league('existing',['a','b'],[fixture('used','a','b')]));
      await error(await post('/audit/v1/leagues',league('existing')),409,'LEAGUE_EXISTS');
      await error(await post('/audit/v1/leagues',league('rollback',['a','b'],[fixture('new-first','a','b'),fixture('used','a','b')])),409,'MATCH_EXISTS');
      assert.equal((await pool.query('SELECT * FROM leagues WHERE league_id=$1',['rollback'])).rowCount,0);assert.equal((await pool.query('SELECT * FROM matches WHERE match_id=$1',['new-first'])).rowCount,0);
      const same=await Promise.all(Array.from({length:8},()=>post('/audit/v1/leagues',league('race'))));assert.equal(same.filter(r=>r.status===201).length,1);assert.equal(same.filter(r=>r.status===409).length,7);
      const shared=await Promise.all(['left','right'].map(id=>post('/audit/v1/leagues',league(id,['a','b'],[fixture('shared','a','b')]))));assert.deepEqual(shared.map(r=>r.status).sort(),[201,409]);assert.equal((await shared.find(r=>r.status===409).json()).error.code,'MATCH_EXISTS');
      await error(await fetch(base+'/audit/v1/standings/missing'),404,'LEAGUE_NOT_FOUND');
      await error(await fetch(base+"/audit/v1/standings/"+encodeURIComponent("x'; DROP TABLE leagues;--")),404,'LEAGUE_NOT_FOUND');
    });
    await t.test('Appendix A lots order, zero H2H matrix and exact response shape',async()=>{
      await reset();await register(league('lg-1',['t1','t2','t3']));const out=await get('lg-1');
      assert.deepEqual(Object.keys(out).sort(),['league_id','sport_id','qualification_spots','table','h2h'].sort());assert.deepEqual(out.table.map(row=>row.team_id),['t1','t3','t2']);assert.deepEqual(out.table.map(row=>row.resolved_by),['draw_lots','draw_lots',null]);
      for(const row of out.table){assert.deepEqual(Object.keys(row).sort(),['rank','team_id','played','won','drawn','lost','scored','conceded','diff','points','fair_play','status','resolved_by'].sort());assert.equal(row.status,'still_possible');}
      for(const a of ['t1','t2','t3'])for(const b of ['t1','t2','t3'])assert.deepEqual(out.h2h[a][b],{played:0,points:0,scored:0,conceded:0});
    });
    await t.test('three-way mini-league and restart-on-split beat overall differential',async()=>{
      await reset();const fixtures=[fixture('ab','a','b'),fixture('bc','b','c'),fixture('ca','c','a'),fixture('da','d','a'),fixture('db','d','b'),fixture('dc','d','c')];await register(league('mini',['a','b','c','d'],fixtures));
      for(const [id,home,away,h,a]of [['ab','a','b',3,0],['bc','b','c',1,0],['ca','c','a',5,0],['da','d','a',10,0],['db','d','b',1,0],['dc','d','c',1,0]])await finish(id,home,away,[h,a]);
      const out=await get('mini');assert.deepEqual(out.table.map(row=>row.team_id),['d','c','a','b']);assert.deepEqual(out.table.map(row=>row.resolved_by),[null,'h2h_diff','h2h_points',null]);
      const a=out.table.find(row=>row.team_id==='a'),b=out.table.find(row=>row.team_id==='b');assert.equal(a.points,3);assert.equal(b.points,3);assert.ok(a.diff<b.diff);assert.deepEqual(out.h2h.a.b,{played:1,points:3,scored:3,conceded:0});assert.deepEqual(out.h2h.b.a,{played:1,points:0,scored:0,conceded:3});
    });
    await t.test('completed-match compensation flips qualification and removes undecided match from H2H',async()=>{
      await reset();await register(league('qualification',['a','b','c'],[fixture('qa','a','b'),fixture('qb','a','c')]));const [target]=await finish('qa','a','b',[1,0]);await finish('qb','a','c',[1,0]);
      const before=await get('qualification');assert.equal(before.table.find(row=>row.team_id==='a').status,'clinched');assert.equal(before.table.find(row=>row.team_id==='b').status,'eliminated');
      await event('qa','compensation',{compensates:target,reason:'Corrected after completion'});
      const after=await get('qualification');assert.equal(after.table.find(row=>row.team_id==='a').status,'still_possible');assert.equal(after.table.find(row=>row.team_id==='b').status,'still_possible');assert.equal(after.table.find(row=>row.team_id==='c').status,'eliminated');assert.equal(after.table.find(row=>row.team_id==='a').played,1);assert.deepEqual(after.h2h.a.b,{played:0,points:0,scored:0,conceded:0});assert.deepEqual(await get('qualification'),after);
      const log=await (await fetch(base+'/audit/v1/score/qa')).json();assert.equal(log.status,'completed');assert.equal(log.outcome,'undecided');assert.ok(log.events.find(e=>e.event_id===target).compensated);
    });
    await t.test('innings NRR aggregates overs, uses full overs for all-out, and rounds to 3 decimals',async()=>{
      await reset();await register(league('nrr',['a','b','c'],[fixture('nrr-ab','a','b'),fixture('nrr-ac','a','c')],{sport_id:'table-innings',tie_break_order:['h2h_diff']}));
      await event('nrr-ab','match_start');for(const name of ['hit','removed','removed'])await event('nrr-ab','score',{team_id:'a',event_type:name});for(const name of ['hit','hit'])await event('nrr-ab','score',{team_id:'b',event_type:name});await event('nrr-ab','match_end');
      await event('nrr-ac','match_start');await event('nrr-ac','score',{team_id:'a',event_type:'hit'});for(let i=0;i<3;i++)await event('nrr-ac','score',{team_id:'c',event_type:'idle'});await event('nrr-ac','match_end');
      const out=await get('nrr');assert.deepEqual(out.table.map(row=>row.team_id),['b','a','c']);assert.equal(out.table.find(row=>row.team_id==='a').diff,-1.029);assert.equal(out.table.find(row=>row.team_id==='b').diff,7.5);assert.equal(out.table.find(row=>row.team_id==='c').diff,-9);assert.equal(out.table[0].resolved_by,'h2h_diff');
    });
    await t.test('round model, custom points, pending fixtures and qualification use config only',async()=>{
      await reset();await register(league('rounds',['a','b','c'],[fixture('r-ab','a','b'),fixture('r-ac','a','c')],{sport_id:'table-round',points:{win:7,draw:2,loss:-2}}));await event('r-ab','match_start');for(const team of ['a','b','a','b','b'])await event('r-ab','score',{team_id:team,event_type:'map'});await event('r-ab','match_end');
      const out=await get('rounds');assert.deepEqual(out.table.map(row=>row.team_id),['b','c','a']);assert.equal(out.table[0].points,7);assert.equal(out.table[0].diff,1);const a=out.table.find(row=>row.team_id==='a');assert.equal(a.points,-2);assert.equal(a.diff,-1);assert.deepEqual(out.h2h.b.a,{played:1,points:7,scored:3,conceded:2});assert.equal(out.table[0].status,'still_possible');assert.equal(a.status,'eliminated');
    });
    await t.test('draws, fair play, scored and overall-diff criteria have exact boundary labels',async()=>{
      await reset();assert.equal((await post('/audit/v1/sports',{...config(),sport_id:'table-draw',draw_allowed:true})).status,201);await register(league('fair',['a','b'],[fixture('fair-ab','a','b')],{sport_id:'table-draw',tie_break_order:['fair_play']}));await finish('fair-ab','a','b',[1,1],[-2,-1]);let out=await get('fair');assert.deepEqual(out.table.map(row=>row.team_id),['b','a']);assert.deepEqual(out.table.map(row=>row.resolved_by),['fair_play',null]);assert.equal(out.table[0].drawn,1);assert.equal(out.table[0].fair_play,-1);assert.ok(out.table.every(row=>row.status==='still_possible'));
      await register(league('diff',['a','b','c'],[fixture('diff-ac','a','c'),fixture('diff-bc','b','c')],{tie_break_order:['overall_diff']}));await finish('diff-ac','a','c',[2,0]);await finish('diff-bc','b','c',[1,0]);out=await get('diff');assert.deepEqual(out.table.map(row=>row.team_id),['a','b','c']);assert.equal(out.table[0].resolved_by,'overall_diff');
      await register(league('scored',['a','b','c'],[fixture('s-ab','a','b'),fixture('s-bc','b','c'),fixture('s-ca','c','a')],{tie_break_order:['scored']}));await finish('s-ab','a','b',[3,2]);await finish('s-bc','b','c',[1,0]);await finish('s-ca','c','a',[2,1]);out=await get('scored');assert.deepEqual(out.table.map(row=>row.team_id),['a','b','c']);assert.deepEqual(out.table.map(row=>row.resolved_by),['scored','scored',null]);
    });
  }finally{await post('/audit/v1/reset',{});await pool.end();}
});
