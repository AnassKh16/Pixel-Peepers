import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import pg from 'pg';

const base = ((process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080') + '');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const request = (path, body) => fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const get = match => fetch(`${base}/audit/v1/score/${encodeURIComponent(match)}`);
const score = async match => {const response=await get(match);assert.equal(response.status,200);return response.json();};
const configured = (model, overrides = {}) => ({
  sport_id:`scoring-${model}`,name:`Mystery ${model}`,scoring_model:model,
  periods:model==='event'?{count:2,duration_minutes:7}:model==='innings'?{innings_per_team:2,overs_per_innings:1,balls_per_over:2,wickets_per_innings:1}:{best_of:3},
  scoring_events:model==='event'?{pulse:{points:3},burst:{points:2}}:model==='innings'?{drift:{runs:2,legal_ball:false,wicket:false},counted:{runs:1,legal_ball:true,wicket:false},removal:{runs:0,legal_ball:true,wicket:true}}:{orbit:{rounds:1},leap:{rounds:2}},
  draw_allowed:false,overtime:{policy:'shootout'},roster:{min_squad_size:1,max_squad_size:9,required_positions:{}},...overrides
});

async function expectError(response,status,code) {
  assert.equal(response.status,status);
  const body=await response.json();
  assert.equal(body.error.code,code);
  assert.equal(typeof body.error.message,'string');
  assert.ok(body.error.details && !Array.isArray(body.error.details));
  return body.error.details;
}

test('Section 5.9 mystery-sport event sourcing API', {skip:process.env.RUN_INTEGRATION!=='1',timeout:120000}, async t => {
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  let counter=0;
  const sent=new Map();
  const make=(match_id,type,payload={},event_id=`evt-${++counter}`)=>({event_id,match_id,type,payload});
  const append=async body=>{
    const response=await request('/audit/v1/events',body);
    assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
    const result=await response.json();
    assert.deepEqual(Object.keys(result).sort(),['event_id','match_id','type','sequence','match_version','signature'].sort());
    assert.equal(result.event_id,body.event_id);
    assert.equal(result.match_id,body.match_id);
    assert.equal(result.type,body.type);
    assert.equal(result.sequence,result.match_version);
    const expected=createHmac('sha256',process.env.DAY1_SALT).update(`${body.event_id}|${canonical(body.payload)}`,'utf8').digest('hex');
    assert.equal(result.signature,expected,'independent HMAC using the known environment test salt');
    sent.set(body.event_id,{body,result});
    return result;
  };
  const init=(match,model='event',extra={})=>append(make(match,'match_init',{sport_id:`scoring-${model}`,home_team_id:'home',away_team_id:'away',...extra}));
  const start=match=>append(make(match,'match_start'));
  const add=(match,team,event_type,extra={})=>append(make(match,'score',{team_id:team,event_type,...extra}));
  const compensate=(match,event_id)=>append(make(match,'compensation',{compensates:event_id,reason:'Correction'}));
  const reset=()=>fetch(base+'/audit/v1/reset',{method:'POST'});
  await reset();
  const baselineEvents=(await pool.query('SELECT * FROM events')).rowCount,baselineMatches=(await pool.query('SELECT * FROM matches')).rowCount;
  try {
    for(const model of ['event','innings','round']) {
      const response=await request('/audit/v1/sports',configured(model));
      assert.equal(response.status,201);
    }
    await t.test('schema and identifier validation; no rejected event is written', async()=>{
      const invalid=[null,[],{},make('bad|id','match_start'),make('missing','unknown'),{...make('missing','score'),event_id:'bad|id'},make('missing','score',null),make('missing','score',[]),make('missing','score',{}),make('missing','score',{team_id:'home',event_type:1}),make('missing','discipline',{team_id:'home',points:1.5}),make('missing','discipline',{team_id:'home',points:'-1'}),make('missing','compensation',{compensates:'id'}),make('missing','compensation',{compensates:'bad|id',reason:'x'}),make('missing','match_init',{sport_id:'scoring-event',home_team_id:'same',away_team_id:'same'})];
      for(const body of invalid) {
        const details=await expectError(await request('/audit/v1/events',body),400,'VALIDATION_ERROR');
        assert.ok(Array.isArray(details.fields)&&details.fields.length>0);
      }
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM events')).rows[0].count,baselineEvents);
    });
    await t.test('unknown match, sport and league return exact reference errors',async()=>{
      await expectError(await get('missing'),404,'MATCH_NOT_FOUND');
      await expectError(await request('/audit/v1/events',make('missing','match_start')),404,'MATCH_NOT_FOUND');
      await expectError(await request('/audit/v1/events',make('missing','match_init',{sport_id:'missing',home_team_id:'home',away_team_id:'away'})),404,'SPORT_NOT_FOUND');
      await expectError(await request('/audit/v1/events',make('missing','match_init',{sport_id:'scoring-event',home_team_id:'home',away_team_id:'away',league_id:'missing'})),404,'LEAGUE_NOT_FOUND');
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM matches')).rows[0].count,baselineMatches);
    });
    let homeScore,awayScore,awayExtra,discipline,tiebreak,end;
    await t.test('event model uses arbitrary configured names, points, UTF-8 signatures and exact initial shape',async()=>{
      const initialized=await init('event-match','event',{league_id:'league-alpha-1'});
      assert.equal(initialized.sequence,1);
      assert.deepEqual(await score('event-match'),{
        match_id:'event-match',sport_id:'scoring-event',league_id:'league-alpha-1',status:'upcoming',outcome:'pending',winner_team_id:null,tiebreak_winner_team_id:null,
        home:{team_id:'home',score:0,wickets:null,balls:null,overs:null,fair_play:0},away:{team_id:'away',score:0,wickets:null,balls:null,overs:null,fair_play:0},version:1,
        events:[{sequence:1,event_id:initialized.event_id,type:'match_init',payload:sent.get(initialized.event_id).body.payload,signature:initialized.signature,compensated:false,compensated_by:null}]
      });
      await start('event-match');
      homeScore=await add('event-match','home','pulse',{note:'اردو',nested:{z:2,a:1},array:[2,1]});
      awayScore=await add('event-match','away','burst');
      awayExtra=await add('event-match','away','pulse');
      discipline=await append(make('event-match','discipline',{team_id:'home',points:-2}));
      tiebreak=await append(make('event-match','tiebreak_winner',{team_id:'home'}));
      const live=await score('event-match');
      assert.equal(live.status,'in_progress');
      assert.equal(live.outcome,'pending');
      assert.equal(live.home.score,3);
      assert.equal(live.away.score,5);
      assert.equal(live.home.fair_play,-2);
      assert.equal(live.winner_team_id,'away');
      assert.equal(live.tiebreak_winner_team_id,'home');
      end=await append(make('event-match','match_end'));
      assert.equal((await score('event-match')).outcome,'away_win');
    });
    await t.test('state, participant, configured-event and duplicate-match errors leave the log unchanged',async()=>{
      await init('upcoming');
      for(const body of [make('upcoming','score',{team_id:'home',event_type:'pulse'}),make('upcoming','discipline',{team_id:'home',points:-1}),make('upcoming','tiebreak_winner',{team_id:'home'})]) await expectError(await request('/audit/v1/events',body),409,'MATCH_NOT_IN_PROGRESS');
      await expectError(await request('/audit/v1/events',make('upcoming','match_end')),409,'ILLEGAL_TRANSITION');
      await expectError(await request('/audit/v1/events',make('event-match','match_start')),409,'ILLEGAL_TRANSITION');
      await expectError(await request('/audit/v1/events',make('event-match','match_end')),409,'ILLEGAL_TRANSITION');
      await expectError(await request('/audit/v1/events',make('event-match','score',{team_id:'home',event_type:'pulse'})),409,'MATCH_NOT_IN_PROGRESS');
      await expectError(await request('/audit/v1/events',make('event-match','match_init',{sport_id:'scoring-event',home_team_id:'home',away_team_id:'away'})),409,'MATCH_EXISTS');
      await start('upcoming');
      await expectError(await request('/audit/v1/events',make('upcoming','match_start')),409,'ILLEGAL_TRANSITION');
      for(const type of ['score','discipline','tiebreak_winner']) {
        const payload={team_id:'outsider',event_type:'pulse',points:-1};
        await expectError(await request('/audit/v1/events',make('upcoming',type,payload)),400,'VALIDATION_ERROR');
      }
      for(const name of ['unknown','__proto__','constructor']) await expectError(await request('/audit/v1/events',make('upcoming','score',{team_id:'home',event_type:name})),400,'UNKNOWN_EVENT_TYPE');
      assert.equal((await score('upcoming')).version,2);
    });
    await t.test('idempotency returns the original sequence, version and signature, including old initialization',async()=>{
      const original=sent.get(homeScore.event_id);
      const response=await request('/audit/v1/events',{...original.body,ignored:'ignored'});
      assert.equal(response.status,200);
      assert.deepEqual(await response.json(),original.result);
      const first=(await score('event-match')).events[0];
      const initReplay=await request('/audit/v1/events',sent.get(first.event_id).body);
      assert.equal(initReplay.status,200);
      assert.equal((await initReplay.json()).sequence,1);
      await expectError(await request('/audit/v1/events',{...original.body,payload:{team_id:'away',event_type:'pulse'}}),409,'DUPLICATE_EVENT_ID');
      await expectError(await request('/audit/v1/events',{...original.body,match_id:'upcoming'}),409,'DUPLICATE_EVENT_ID');
      assert.equal((await score('event-match')).version,end.sequence);
    });
    let correction;
    await t.test('completed-match compensation changes the projection but never modifies the original rows',async()=>{
      const originals=(await pool.query('SELECT event_id,data FROM events WHERE match_id=$1 ORDER BY sequence',['event-match'])).rows;
      correction=await compensate('event-match',awayExtra.event_id);
      await compensate('event-match',discipline.event_id);
      let result=await score('event-match');
      assert.equal(result.status,'completed');
      assert.equal(result.outcome,'home_win');
      assert.equal(result.home.score,3);
      assert.equal(result.away.score,2);
      assert.equal(result.home.fair_play,0);
      const target=result.events.find(event=>event.event_id===awayExtra.event_id);
      assert.equal(target.compensated,true);
      assert.equal(target.compensated_by,correction.event_id);
      assert.equal(result.events.find(event=>event.event_id===correction.event_id).compensated,false);
      for(const original of originals) assert.deepEqual((await pool.query('SELECT data FROM events WHERE event_id=$1',[original.event_id])).rows[0].data,original.data);
      await compensate('event-match',homeScore.event_id);
      await compensate('event-match',awayScore.event_id);
      result=await score('event-match');
      assert.equal(result.home.score,0);
      assert.equal(result.away.score,0);
      assert.equal(result.outcome,'home_win');
      await compensate('event-match',tiebreak.event_id);
      result=await score('event-match');
      assert.equal(result.status,'completed');
      assert.equal(result.outcome,'undecided');
      assert.equal(result.winner_team_id,null);
      assert.equal(result.tiebreak_winner_team_id,null);
    });
    await t.test('missing, repeated, wrong-type and cross-match compensation errors',async()=>{
      await expectError(await request('/audit/v1/events',make('event-match','compensation',{compensates:'missing',reason:'x'})),404,'EVENT_NOT_FOUND');
      const first=(await score('event-match')).events[0];
      for(const target of [first.event_id,end.event_id,correction.event_id,awayExtra.event_id]) {
        await expectError(await request('/audit/v1/events',make('event-match','compensation',{compensates:target,reason:'x'})),409,'INVALID_COMPENSATION');
      }
      await expectError(await request('/audit/v1/events',make('upcoming','compensation',{compensates:homeScore.event_id,reason:'x'})),409,'INVALID_COMPENSATION');
    });
    await t.test('tie policy rejects completion until a winner is declared; compensating it yields undecided',async()=>{
      await init('tie-match');await start('tie-match');
      await expectError(await request('/audit/v1/events',make('tie-match','match_end')),409,'TIE_NOT_ALLOWED');
      const winner=await append(make('tie-match','tiebreak_winner',{team_id:'away'}));
      await append(make('tie-match','match_end'));
      assert.equal((await score('tie-match')).outcome,'away_win');
      await compensate('tie-match',winner.event_id);
      assert.equal((await score('tie-match')).outcome,'undecided');
    });
    await t.test('configured draws and most recent active tie-break declaration are data-driven',async()=>{
      assert.equal((await request('/audit/v1/sports',configured('event',{sport_id:'scoring-draw',draw_allowed:true}))).status,201);
      await append(make('draw-match','match_init',{sport_id:'scoring-draw',home_team_id:'home',away_team_id:'away'}));
      await start('draw-match');await append(make('draw-match','match_end'));
      assert.equal((await score('draw-match')).outcome,'draw');
      await init('tie-history');await start('tie-history');
      await append(make('tie-history','tiebreak_winner',{team_id:'home'}));
      const latest=await append(make('tie-history','tiebreak_winner',{team_id:'away'}));
      await compensate('tie-history',latest.event_id);
      assert.equal((await score('tie-history')).tiebreak_winner_team_id,'home');
      await append(make('tie-history','match_end'));
      assert.equal((await score('tie-history')).outcome,'home_win');
    });
    await t.test('innings config: runs, illegal balls, overs, per-team ball limit and compensation',async()=>{
      await init('innings-match','innings');await start('innings-match');
      await add('innings-match','home','drift');
      let result=await score('innings-match');
      assert.equal(result.home.score,2);assert.equal(result.home.balls,0);assert.equal(result.home.overs,'0.0');
      const legal=[];
      for(let i=0;i<4;i++) legal.push(await add('innings-match','home','counted'));
      result=await score('innings-match');
      assert.deepEqual(result.home,{team_id:'home',score:6,wickets:0,balls:4,overs:'2.0',fair_play:0});
      await expectError(await request('/audit/v1/events',make('innings-match','score',{team_id:'home',event_type:'drift'})),409,'INNINGS_COMPLETE');
      await compensate('innings-match',legal[3].event_id);
      result=await score('innings-match');
      assert.equal(result.home.balls,3);assert.equal(result.home.overs,'1.1');assert.equal(result.home.score,5);
      await add('innings-match','home','drift');
      await add('innings-match','home','counted');
      assert.equal((await score('innings-match')).home.score,8);
    });
    await t.test('innings config: independent wicket limit across innings, reversible by compensation',async()=>{
      await add('innings-match','away','removal');
      const second=await add('innings-match','away','removal');
      let result=await score('innings-match');
      assert.equal(result.away.wickets,2);assert.equal(result.away.balls,2);assert.equal(result.away.overs,'1.0');
      await expectError(await request('/audit/v1/events',make('innings-match','score',{team_id:'away',event_type:'drift'})),409,'INNINGS_COMPLETE');
      await compensate('innings-match',second.event_id);
      await add('innings-match','away','drift');
      await add('innings-match','away','removal');
      result=await score('innings-match');
      assert.equal(result.away.wickets,2);assert.equal(result.away.balls,2);assert.equal(result.away.score,2);
      await append(make('innings-match','match_end'));
      assert.equal((await score('innings-match')).outcome,'home_win');
    });
    await t.test('round config: series threshold blocks both teams and compensated wins no longer count',async()=>{
      await init('round-match','round');await start('round-match');
      await add('round-match','home','orbit');await add('round-match','away','orbit');
      const clincher=await add('round-match','home','orbit');
      await expectError(await request('/audit/v1/events',make('round-match','score',{team_id:'away',event_type:'orbit'})),409,'SERIES_ALREADY_DECIDED');
      await compensate('round-match',clincher.event_id);
      const newWinner=await add('round-match','away','orbit');
      await append(make('round-match','match_end'));
      let result=await score('round-match');
      assert.equal(result.outcome,'away_win');assert.equal(result.home.score,1);assert.equal(result.away.score,2);
      assert.equal(result.home.wickets,null);assert.equal(result.home.balls,null);assert.equal(result.home.overs,null);
      await compensate('round-match',newWinner.event_id);
      result=await score('round-match');assert.equal(result.outcome,'undecided');assert.equal(result.away.score,1);
      await init('round-multiple','round');await start('round-multiple');await add('round-multiple','home','leap');
      await expectError(await request('/audit/v1/events',make('round-multiple','score',{team_id:'home',event_type:'orbit'})),409,'SERIES_ALREADY_DECIDED');
    });
    await t.test('20 concurrent appends get contiguous unique sequences; 20 identical appends write once',async()=>{
      await init('parallel');await start('parallel');
      const bodies=Array.from({length:20},()=>make('parallel','score',{team_id:'home',event_type:'pulse'}));
      const responses=await Promise.all(bodies.map(body=>request('/audit/v1/events',body)));
      for(const response of responses) assert.equal(response.status,201);
      const results=await Promise.all(responses.map(response=>response.json()));
      assert.deepEqual(results.map(result=>result.sequence).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+3));
      let result=await score('parallel');assert.equal(result.version,22);assert.equal(result.home.score,60);
      const replay=make('parallel','score',{team_id:'home',event_type:'pulse'});
      const replays=await Promise.all(Array.from({length:20},()=>request('/audit/v1/events',replay)));
      assert.equal(replays.filter(response=>response.status===201).length,1);
      assert.equal(replays.filter(response=>response.status===200).length,19);
      const replayBodies=await Promise.all(replays.map(response=>response.json()));
      for(const body of replayBodies) assert.deepEqual(body,replayBodies[0]);
      result=await score('parallel');assert.equal(result.version,23);assert.equal(result.home.score,63);
      const duplicates=await pool.query('SELECT match_id,sequence FROM events GROUP BY match_id,sequence HAVING count(*)>1');
      assert.equal(duplicates.rowCount,0);
    });
    await t.test('concurrent initialization and global event-id collisions return contract conflicts',async()=>{
      const initialized=await Promise.all([1,2].map(()=>request('/audit/v1/events',make('parallel-init','match_init',{sport_id:'scoring-event',home_team_id:'home',away_team_id:'away'}))));
      assert.deepEqual(initialized.map(response=>response.status).sort(),[201,409]);
      assert.equal((await initialized.find(response=>response.status===409).json()).error.code,'MATCH_EXISTS');
      await start('parallel-init');
      const shared=`global-${++counter}`;
      const collisions=await Promise.all(['parallel','parallel-init'].map(match=>request('/audit/v1/events',make(match,'score',{team_id:'home',event_type:'pulse'},shared))));
      assert.deepEqual(collisions.map(response=>response.status).sort(),[201,409]);
      assert.equal((await collisions.find(response=>response.status===409).json()).error.code,'DUPLICATE_EVENT_ID');
    });
    await t.test('fixture-created stream starts at version zero without needing match_init',async()=>{
      await pool.query('INSERT INTO matches(match_id,data) VALUES ($1,$2)',['fixture-stream',{sport_id:'scoring-event',home_team_id:'home',away_team_id:'away',league_id:'league-alpha-1'}]);
      let result=await score('fixture-stream');assert.equal(result.version,0);assert.equal(result.status,'upcoming');
      const started=await start('fixture-stream');assert.equal(started.sequence,1);
      await add('fixture-stream','home','pulse');
      result=await score('fixture-stream');assert.equal(result.version,2);assert.equal(result.home.score,3);
    });
    await t.test('database rejects UPDATE/DELETE of event rows, and every read reflects the complete signed log',async()=>{
      const existing=sent.get(homeScore.event_id);
      await assert.rejects(pool.query('UPDATE events SET data=data WHERE event_id=$1',[homeScore.event_id]),/append-only/);
      await assert.rejects(pool.query('DELETE FROM events WHERE event_id=$1',[homeScore.event_id]),/append-only/);
      assert.deepEqual((await pool.query('SELECT data FROM events WHERE event_id=$1',[homeScore.event_id])).rows[0].data,{request:existing.body,response:existing.result});
      for(const match of ['event-match','innings-match','round-match','parallel']) {
        const result=await score(match);
        assert.equal(result.events.length,result.version);
        assert.deepEqual(result.events.map(event=>event.sequence),Array.from({length:result.version},(_,i)=>i+1));
        for(const event of result.events) {
          const expected=createHmac('sha256',process.env.DAY1_SALT).update(`${event.event_id}|${canonical(event.payload)}`,'utf8').digest('hex');
          assert.equal(event.signature,expected);
        }
      }
    });
    await t.test('reset removes custom sports and complete immutable logs',async()=>{
      assert.equal((await reset()).status,200);
      assert.equal((await pool.query('SELECT * FROM events')).rowCount,baselineEvents);
      assert.equal((await pool.query('SELECT * FROM sports')).rowCount,4);
      await expectError(await get('event-match'),404,'MATCH_NOT_FOUND');
    });
  } finally {await reset();await pool.end();}
});

