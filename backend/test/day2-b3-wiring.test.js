import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import pg from 'pg';
import {WebSocket} from 'ws';
import {signDay2} from '../src/day2-signature.js';
import {rosterEntries} from '../src/roster-projection.js';

const base=process.env.TEST_BASE_URL??'http://127.0.0.1:8080';
async function call(path,body,token,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
}
const request={chat_room_id:'chat-cs-session-101',incoming_messages:[
  {message_id:'m1',sender:'clean',text:'Clean sports commentary'},
  {message_id:'m2',sender:'spammer',text:'Watch b@d_w0rd now!'},
  {message_id:'m3',sender:'flooder',text:'GOAL! AAAA!!!'},
  {message_id:'m4',sender:'spammer',text:'p0rn'},
  {message_id:'m5',sender:'flooder',text:'???'}]};

test('B3 mounted routes, live measurements and immutable roster redaction',{skip:process.env.RUN_INTEGRATION!=='1',timeout:60000},async t=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const reset=()=>call('/audit/v1/reset',{});
  async function metrics(){
    const response=await fetch(base+'/metrics');assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/^text\/plain;\s*version=0\.0\.4(?:;|$)/);
    const text=await response.text();assert.match(text,/^# HELP /);
    return Object.fromEntries(text.split('\n').filter(line=>line&&!line.startsWith('#')).map(line=>{const [key,value]=line.split(' ');return [key,Number(value)];}));
  }
  try{
    await reset();
    await t.test('moderation example, ordered deduplication and exact signature through Express',async()=>{
      const r=await call('/audit/v1/moderation/test',request);assert.equal(r.status,200);
      assert.deepEqual(r.body.filtered_messages.map(m=>m.text),['Clean sports commentary','Watch *** now!','***']);
      assert.deepEqual(r.body.kicked_users,['spammer']);assert.deepEqual(r.body.muted_users,['flooder']);
      assert.deepEqual(r.body.dlq_status,{queue_depth:0,undelivered_events:[]});
      assert.equal(r.body.signature,signDay2(request.chat_room_id,{chat_room_id:request.chat_room_id,flagged_count:2,kicked_users:['spammer'],queue_depth:0}));
      assert.deepEqual(Object.keys(r.body).sort(),['chat_room_id','filtered_messages','kicked_users','muted_users','dlq_status','signature'].sort());
    });
    await t.test('ten simultaneous moderation calls have no cross-request throttle',async()=>{
      const responses=await Promise.all(Array.from({length:10},()=>call('/audit/v1/moderation/test',request)));
      for(const r of responses){assert.equal(r.status,200);assert.deepEqual(r.body.kicked_users,['spammer']);assert.deepEqual(r.body.muted_users,['flooder']);}
    });
    await t.test('moderation malformed JSON, oversized body and schema errors retain standard envelopes',async()=>{
      for(const [body,status,code]of [['{',400,'VALIDATION_ERROR'],[JSON.stringify({text:'x'.repeat(1048576)}),413,'PAYLOAD_TOO_LARGE']]){
        const r=await fetch(base+'/audit/v1/moderation/test',{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(r.status,status);const b=await r.json();assert.equal(b.error.code,code);if(status===400)assert.deepEqual(b.error.details.fields,['body']);
      }
      const r=await call('/audit/v1/moderation/test',{chat_room_id:4});assert.equal(r.status,400);assert.equal(r.body.error.code,'VALIDATION_ERROR');
    });
    await t.test('persistent DLQ depth and QR metrics change on each scrape and reset clears both',async()=>{
      assert.equal((await metrics()).nascon_dlq_depth,0);
      const r=await call('/audit/v1/moderation/test',{...request,simulate_failed_notifications:2});assert.equal(r.status,200);assert.equal(r.body.dlq_status.queue_depth,2);assert.ok(r.body.dlq_status.undelivered_events.every(e=>e.attempts===3));
      await call('/audit/v1/qr/match-m1');let m=await metrics();assert.equal(m.nascon_dlq_depth,2);assert.equal(m.nascon_qr_scans_total,1);
      await reset();m=await metrics();assert.equal(m.nascon_dlq_depth,0);assert.equal(m.nascon_qr_scans_total,0);
    });
    await t.test('live metrics count active solo/co-stream records and real WebSocket/SSE subscriptions',async()=>{
      assert.equal((await metrics()).nascon_active_streams_total,0);
      assert.equal((await call('/audit/v1/stream/key',{action:'generate',player_id:'player-alpha-1'})).status,201);
      assert.equal((await call('/audit/v1/costream/session',{session_id:'cs-session-metrics',host_player_id:'player-alpha-1',participants:['player-alpha-1','player-alpha-2'],layout:'grid_2'})).status,201);
      assert.equal((await metrics()).nascon_active_streams_total,2);
      const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws/matches/match-m1');const initial=once(ws,'message');await once(ws,'open');await initial;
      const controller=new AbortController();let reader;
      try{
        const response=await fetch(base+'/api/v1/matches/match-m1/stream',{signal:controller.signal});reader=response.body.getReader();await reader.read();
        const m=await metrics();assert.equal(m.nascon_active_ws_connections,2);assert.ok(Number.isFinite(m.nascon_stream_bitrate_kbps));assert.ok(m.nascon_stream_bitrate_kbps>=0);
      }finally{controller.abort();await reader?.cancel().catch(()=>{});const closed=once(ws,'close');ws.close();await closed;}
      for(let attempt=0;attempt<20;attempt++){if((await metrics()).nascon_active_ws_connections===0)return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('subscriber gauge did not return to zero');
    });
    await t.test('erasure redacts roster response copies, revokes linked credentials and preserves every audit row',async()=>{
      await reset();
      const tokens=(await call('/audit/v1/rbac-matrix',{})).body.tokens;
      const scenario=(await pool.query('SELECT data FROM rosters WHERE roster_id=$1',['league-alpha-1'])).rows[0].data;
      const current=scenario.players.find(p=>p.player_id==='player-alpha-1');
      const record={generation:scenario.generation??'baseline',audit_entry:{audit_id:'b3-immutable',action:'transfer',player_id:current.player_id,league_id:'league-alpha-1',effective_date:'2026-01-02',from_squad_id:current.squad_id,to_squad_id:current.squad_id,who:'manager',when:'2026-01-02T00:00:00Z',why:'test',name:'Former Athlete'},before:{...current,name:'Former Athlete'},after:{...current,name:'Ali Ahmed'}};
      await pool.query('INSERT INTO roster_history(audit_id,player_id,league_id,data) VALUES ($1,$2,$3,$4)',['b3-immutable',current.player_id,'league-alpha-1',record]);
      await pool.query('INSERT INTO guest_tokens VALUES ($1,$2)',['viewer_linked_test',{valid:true,user_id:current.player_id}]);
      const before=(await pool.query('SELECT audit_id,data,entry_sequence FROM roster_history ORDER BY entry_sequence')).rows;
      const events=(await pool.query('SELECT event_id,data FROM events ORDER BY event_id')).rows;
      const r=await call('/audit/v1/privacy/user/player-alpha-1',undefined,undefined,'DELETE');assert.equal(r.status,200);
      assert.deepEqual(r.body,{user_id:'player-alpha-1',status:'anonymized',pii_retained:false,tokens_wiped:true});
      assert.equal((await call('/api/v1/me',undefined,tokens.player)).status,401);
      assert.equal((await call('/api/v1/players/player-alpha-1',undefined,'viewer_linked_test')).status,401);
      const history=await call('/audit/v1/roster/history/player-alpha-1?as_of=2026-01-02');assert.equal(history.status,200);assert.equal(history.body.history[0].name,'Anonymized user');
      for(const token of [undefined,tokens.viewer]){const club=await call('/api/v1/clubs/club-alpha-1',undefined,token);assert.equal(club.status,200);assert.equal(club.body.roster.find(p=>p.player_id===current.player_id).name,'Anonymized user');}
      const entries=await rosterEntries(pool,scenario,current.player_id);assert.equal(entries[0].before.name,'Anonymized user');assert.equal(entries[0].after.name,'Anonymized user');
      assert.deepEqual((await pool.query('SELECT audit_id,data,entry_sequence FROM roster_history ORDER BY entry_sequence')).rows,before);
      assert.deepEqual((await pool.query('SELECT event_id,data FROM events ORDER BY event_id')).rows,events);
      assert.equal((await call('/audit/v1/privacy/user/player-alpha-1',undefined,tokens.player,'DELETE')).status,200);
      assert.equal((await call('/audit/v1/privacy/user/missing',undefined,undefined,'DELETE')).body.error.code,'PLAYER_NOT_FOUND');
      await reset();assert.equal((await call('/api/v1/me',undefined,tokens.player)).status,200);
    });
  }finally{await reset();await pool.end();}
});
