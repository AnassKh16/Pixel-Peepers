import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import pg from 'pg';
import {signDay2, requireDay2Salt} from '../src/day2-signature.js';
import {mediaReady, disconnectMediaKeys} from '../src/streaming.js';
import {createServer} from 'node:http';
import {once} from 'node:events';

const base = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080';
const players = ['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2'];
const post = async (path, body) => {
  const response = await fetch(base + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  return {status:response.status, body:response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text()};
};
const keyRequest = (changes={}) => ({action:'generate', player_id:players[0], ...changes});
const sessionRequest = (changes={}) => ({session_id:'cs-session-101', host_player_id:players[0], participants:players, ...changes});
const error = (result, status, code, field) => {
  assert.equal(result.status,status,JSON.stringify(result.body));
  assert.deepEqual(Object.keys(result.body),['error']);
  assert.deepEqual(Object.keys(result.body.error).sort(),['code','details','message']);
  assert.equal(result.body.error.code,code);
  if (field) assert.ok(result.body.error.details.fields.includes(field),JSON.stringify(result.body));
};
const streamPayload = (action, body) => ({action,player_id:body.player_id,status:body.status,stream_key:body.stream_key});
const sessionPayload = body => Object.fromEntries(['active_host','handoff_occurred','layout','participant_count','session_id','status'].map(k=>[k,body[k]]));

// The key is supplied exclusively by the environment, never embedded in a test.
test('Day 2 Appendix A exact message string and pipe separator', {skip:!process.env.DAY2_SALT}, () => {
  const id='sk_live_9f83a1b2c3d4e5f6';
  const payload={stream_key:id,status:'active',player_id:players[0],action:'rotate'};
  const message='sk_live_9f83a1b2c3d4e5f6|{"action":"rotate","player_id":"player-alpha-1","status":"active","stream_key":"sk_live_9f83a1b2c3d4e5f6"}';
  const expected=createHmac('sha256',process.env.DAY2_SALT).update(message,'utf8').digest('hex');
  assert.equal(signDay2(id,payload),expected);
  assert.match(expected,/^[a-f0-9]{64}$/);
  assert.notEqual(expected,createHmac('sha256',process.env.DAY2_SALT).update(message.replace('|',':')).digest('hex'));
});
test('Day 2 salt is required from the environment and is never trimmed', () => {
  const original=process.env.DAY2_SALT;
  try {
    delete process.env.DAY2_SALT;
    assert.throws(()=>requireDay2Salt(),/DAY2_SALT/);
    assert.throws(()=>signDay2('id',{}),/DAY2_SALT/);
    if(original){process.env.DAY2_SALT=` ${original} `;assert.equal(signDay2('id',{}),createHmac('sha256',process.env.DAY2_SALT).update('id|{}').digest('hex'));}
  } finally {if(original===undefined)delete process.env.DAY2_SALT;else process.env.DAY2_SALT=original;}
});
test('media readiness requires a responding MediaMTX API, not merely an open TCP port',async()=>{
  let mode='ok';
  const server=createServer((_req,res)=>{if(mode==='ok'){res.setHeader('Content-Type','application/json');res.end('{"items":[]}');}else if(mode==='bad'){res.end('{}');}else{res.statusCode=503;res.end();}}).listen(0,'127.0.0.1');
  await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try {await mediaReady(url);mode='bad';await assert.rejects(mediaReady(url));mode='down';await assert.rejects(mediaReady(url));}
  finally {await new Promise(resolve=>server.close(resolve));}
  await assert.rejects(mediaReady(url));
});

test('revocation disconnects only matching publishers and readers through the control API',async()=>{
  const kicked=[];
  const server=createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.method==='GET')res.end(JSON.stringify({pageCount:1,items:[
      {name:'live/revoked',source:{type:'rtmpConn',id:'publisher'},readers:[{type:'webRTCSession',id:'reader'},{type:'hlsMuxer',id:'hls'}]},
      {name:'live/other',source:{type:'rtmpConn',id:'keep'},readers:[]}]}));
    else{kicked.push(req.url);res.statusCode=req.url.includes('reader')?404:200;res.end('{}');}
  }).listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${server.address().port}`;
  try{await disconnectMediaKeys(['revoked'],url);assert.deepEqual(kicked.sort(),['/v3/rtmpconns/kick/publisher','/v3/webrtcsessions/kick/reader']);}
  finally{await new Promise(resolve=>server.close(resolve));}
  await assert.rejects(disconnectMediaKeys(['revoked'],url),e=>e.status===503&&e.code==='NOT_READY');
});

test('live Grid has three ready nodes and runs two Chrome sessions plus one Firefox', {skip:process.env.RUN_INTEGRATION!=='1',timeout:60000}, async()=>{
  const grid=process.env.GRID_URL??'http://selenium-hub:4444',sessions=[];
  const call=async(path,body,method=body===undefined?'GET':'POST')=>{
    const response=await fetch(grid+path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});
    const json=await response.json();assert.equal(response.status,200,JSON.stringify(json));return json.value;
  };
  const status=await call('/status');assert.equal(status.ready,true);assert.ok(status.nodes.length>=3);
  try{
    const results=await Promise.allSettled(['chrome','chrome','firefox'].map(async browserName=>{
      const options=browserName==='chrome'?{'goog:chromeOptions':{args:['--headless=new','--no-sandbox','--disable-dev-shm-usage']}}:{'moz:firefoxOptions':{args:['-headless']}};
      const session=await call('/session',{capabilities:{alwaysMatch:{browserName,...options}}});sessions.push(session.sessionId);
      await call(`/session/${session.sessionId}/url`,{url:'http://backend:8080/health'});
      const body=await call(`/session/${session.sessionId}/execute/sync`,{script:'return document.body.innerText',args:[]});assert.equal(JSON.parse(body).status,'ok');
    }));
    for(const result of results)if(result.status==='rejected')throw result.reason;
    assert.equal(sessions.length,3);
  }finally{await Promise.all(sessions.map(id=>call(`/session/${id}`,undefined,'DELETE')));}
});

test('Day 2 B1 live baseline, stream keys, media refusal, and co-stream contracts', {skip:process.env.RUN_INTEGRATION!=='1',timeout:120000}, async t => {
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const reset=()=>post('/audit/v1/reset',{});
  const stream=body=>post('/audit/v1/stream/key',body);
  const session=body=>post('/audit/v1/costream/session',body);
  try {
    await reset();
    await t.test('reset retains Day 1 shape and deterministically seeds all Day 2 defaults',async()=>{
      const r=await reset();assert.equal(r.status,200);assert.deepEqual(Object.keys(r.body).sort(),['status','seed','sports','tenants','stock'].sort());
      assert.equal((await pool.query('SELECT club_id FROM players WHERE player_id=$1',[players[3]])).rows[0].club_id,'club-beta-1');
      const score=await (await fetch(base+'/audit/v1/score/match-m1')).json();
      assert.equal(score.status,'in_progress');assert.equal(score.sport_id,'football');assert.equal(score.league_id,'league-alpha-1');
      assert.equal(score.home.team_id,'club-alpha-1');assert.equal(score.away.team_id,'club-alpha-2');assert.equal(score.home.score,1);assert.equal(score.away.score,0);
      const rows=(await pool.query('SELECT data FROM qr_mappings ORDER BY entity_id')).rows.map(r=>r.data);
      assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.short_url).sort(),['http://localhost:8080/q/c-alpha-1','http://localhost:8080/q/m1-live','http://localhost:8080/q/p-alpha-1']);assert.ok(rows.every(r=>r.scan_count===0));
      const guest=(await pool.query('SELECT data FROM guest_tokens WHERE guest_token=$1',['guest_anon_tok_7721'])).rows[0].data;
      assert.deepEqual(guest,{role:'guest',read_only:true,valid:true,merged:false,registered_user_id:null});
      assert.deepEqual((await pool.query('SELECT data FROM user_carts WHERE user_id=$1',[players[0]])).rows[0].data,{items:[]});
      await reset();assert.deepEqual((await pool.query('SELECT data FROM qr_mappings ORDER BY entity_id')).rows.map(r=>r.data),rows);
      assert.deepEqual(await (await fetch(base+'/health')).json(),{status:'ok'});
    });
    const invalidKeys=[null,[],{},keyRequest({action:'activate'}),keyRequest({player_id:7}),keyRequest({label:''}),keyRequest({label:'x'.repeat(65)}),keyRequest({label:null}),keyRequest({stream_key_override:1}),keyRequest({stream_key_override:''})];
    for(const [i,body]of invalidKeys.entries())await t.test(`stream schema validation ${i+1}`,async()=>error(await stream(body),400,'VALIDATION_ERROR'));
    await t.test('stream schema failure precedes missing player',async()=>error(await stream(keyRequest({player_id:'missing',action:'bad'})),400,'VALIDATION_ERROR','action'));
    await t.test('stream missing player precedes missing stream',async()=>error(await stream(keyRequest({action:'revoke',player_id:'missing'})),404,'PLAYER_NOT_FOUND'));
    await t.test('revoke without any key is STREAM_NOT_FOUND',async()=>error(await stream(keyRequest({action:'revoke'})),404,'STREAM_NOT_FOUND'));
    await t.test('generate exact shape, default label, URLs, key regex, and full four-key signature',async()=>{
      const r=await stream(keyRequest());assert.equal(r.status,201);const b=r.body;
      assert.deepEqual(Object.keys(b).sort(),['player_id','label','stream_key','status','ingest_endpoints','playback_url','signature'].sort());
      assert.match(b.stream_key,/^sk_live_[a-f0-9]{16}$/);assert.equal(b.label,'default');assert.equal(b.status,'active');
      assert.deepEqual(b.ingest_endpoints,{rtmp:`rtmp://localhost:1935/live/${b.stream_key}`,webrtc:`http://localhost:8889/live/${b.stream_key}/whip`});
      assert.equal(b.playback_url,`http://localhost:8888/live/${b.stream_key}/index.m3u8`);assert.equal(b.signature,signDay2(b.stream_key,streamPayload('generate',b)));
      for(const action of ['publish','read','playback'])assert.equal((await post('/internal/media/auth',{action,path:`live/${b.stream_key}`})).status,200);
      const next=await stream(keyRequest());assert.equal(next.status,201);assert.notEqual(next.body.stream_key,b.stream_key);
      error(await post('/internal/media/auth',{action:'publish',path:`live/${b.stream_key}`}),409,'KEY_REVOKED');
    });
    await t.test('rotate override matches Appendix A and invalidates prior key',async()=>{
      const prior=(await stream(keyRequest())).body.stream_key;
      const r=await stream(keyRequest({action:'rotate',label:'OBS-Main-Desk',stream_key_override:'sk_live_9f83a1b2c3d4e5f6'}));
      assert.equal(r.status,200);assert.equal(r.body.stream_key,'sk_live_9f83a1b2c3d4e5f6');assert.equal(r.body.label,'OBS-Main-Desk');
      assert.equal(r.body.signature,signDay2(r.body.stream_key,streamPayload('rotate',r.body)));
      error(await post('/internal/media/auth',{action:'publish',path:`live/${prior}`}),409,'KEY_REVOKED');
    });
    await t.test('override is used exactly, including legacy Appendix A entity ID',async()=>{
      const r=await stream(keyRequest({action:'rotate',stream_key_override:'sk_live_101'}));assert.equal(r.status,200);assert.equal(r.body.stream_key,'sk_live_101');
      error(await stream(keyRequest({player_id:players[1],stream_key_override:'sk_live_101'})),400,'VALIDATION_ERROR','stream_key_override');
    });
    await t.test('revoke returns null endpoints, signs revoked state, and real HLS refuses it',async()=>{
      const current=(await stream(keyRequest())).body.stream_key;
      const r=await stream(keyRequest({action:'revoke'}));assert.equal(r.status,200);assert.equal(r.body.stream_key,current);assert.equal(r.body.status,'revoked');
      assert.equal(r.body.ingest_endpoints,null);assert.equal(r.body.playback_url,null);assert.equal(r.body.signature,signDay2(current,streamPayload('revoke',r.body)));
      for(const action of ['publish','read','playback'])error(await post('/internal/media/auth',{action,path:`live/${current}`}),409,'KEY_REVOKED');
      const response=await fetch(`http://mediamtx:8888/live/${current}/index.m3u8`,{signal:AbortSignal.timeout(5000)});assert.ok(response.status===401||response.status===403,`Real media response: ${response.status}`);
      error(await stream(keyRequest({action:'rotate',stream_key_override:current})),409,'KEY_REVOKED');
      assert.equal((await stream(keyRequest({action:'revoke'}))).status,200);
    });
    await t.test('media callback validates input and refuses unknown keys, sessions, and composite publishers',async()=>{
      error(await post('/internal/media/auth',{}),400,'VALIDATION_ERROR');
      error(await post('/internal/media/auth',{action:'publish',path:'live/missing'}),404,'STREAM_NOT_FOUND');
      error(await post('/internal/media/auth',{action:'read',path:'costream/missing'}),404,'STREAM_NOT_FOUND');
      error(await post('/internal/media/auth',{action:'publish',path:'costream/cs-session-101'}),404,'STREAM_NOT_FOUND');
    });
    await t.test('concurrent generates leave exactly one active key for the player',async()=>{
      const results=await Promise.all(Array.from({length:10},()=>stream(keyRequest({player_id:players[1]}))));assert.ok(results.every(r=>r.status===201));
      assert.equal(new Set(results.map(r=>r.body.stream_key)).size,10);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM stream_keys WHERE player_id=$1 AND status='active'",[players[1]])).rows[0].n,1);
    });
    const invalidSessions=[null,[],{},sessionRequest({session_id:3}),sessionRequest({host_player_id:null}),sessionRequest({participants:[]}),sessionRequest({participants:[players[0],players[0]]}),sessionRequest({participants:[players[0],2]}),sessionRequest({layout:'grid_8'}),sessionRequest({layout:null}),sessionRequest({simulate_host_drop:1})];
    for(const [i,body]of invalidSessions.entries())await t.test(`co-stream schema validation ${i+1}`,async()=>error(await session(body),400,'VALIDATION_ERROR'));
    await t.test('schema precedes missing references',async()=>error(await session(sessionRequest({host_player_id:'missing',layout:'bad'})),400,'VALIDATION_ERROR','layout'));
    await t.test('missing participant precedes host membership, capacity and layout checks',async()=>error(await session(sessionRequest({host_player_id:players[3],participants:[players[0],players[1],players[2],'missing','other-missing'],layout:'solo'})),404,'PLAYER_NOT_FOUND'));
    await t.test('missing host also produces PLAYER_NOT_FOUND',async()=>error(await session(sessionRequest({host_player_id:'missing'})),404,'PLAYER_NOT_FOUND'));
    await t.test('existing host outside participants is validation error before layout',async()=>error(await session(sessionRequest({participants:players.slice(1),layout:'solo'})),400,'VALIDATION_ERROR','host_player_id'));
    await t.test('capacity precedes layout and counts submitted participants before drop',async()=>{
      const fifth='demo-player-alpha-02';
      error(await session(sessionRequest({participants:[...players,fifth],layout:'solo',simulate_host_drop:true})),409,'COSTREAM_SESSION_FULL');
    });
    for(const [layout,count,drop,allowed] of [['solo',2,false,false],['grid_2',3,false,false],['grid_2',4,true,false],['solo',2,true,true],['grid_2',3,true,true],['spotlight',4,false,true],['grid_4',4,false,true]])await t.test(`layout ${layout}, ${count} submitted, drop ${drop}`,async()=>{
      const r=await session(sessionRequest({session_id:`layout-${layout}-${count}-${drop}`,participants:players.slice(0,count),layout,simulate_host_drop:drop}));
      if(allowed)assert.equal(r.status,201);else error(r,400,'UNSUPPORTED_LAYOUT');
    });
    await t.test('default layout and no-drop state have exact response and signature',async()=>{
      const r=await session(sessionRequest());assert.equal(r.status,201);const b=r.body;
      assert.deepEqual(Object.keys(b).sort(),['session_id','status','active_host','handoff_occurred','participant_count','active_participants','layout','composite_playback_url','chat_room_id','signature'].sort());
      assert.equal(b.status,'active');assert.equal(b.active_host,players[0]);assert.equal(b.handoff_occurred,false);assert.equal(b.participant_count,4);assert.deepEqual(b.active_participants,players);assert.equal(b.layout,'grid_4');
      assert.equal(b.chat_room_id,'chat-cs-session-101');assert.equal(b.composite_playback_url,'http://localhost:8888/costream/cs-session-101/index.m3u8');assert.equal(b.signature,signDay2(b.session_id,sessionPayload(b)));
      assert.equal((await post('/internal/media/auth',{action:'read',path:'costream/cs-session-101'})).status,200);
      const replay=await session(sessionRequest());assert.equal(replay.status,200);assert.deepEqual(replay.body,b);
    });
    await t.test('host drop keeps URL and chat room, first remaining wins even when host is not first',async()=>{
      const r=await session(sessionRequest({host_player_id:players[2],simulate_host_drop:true}));assert.equal(r.status,201);const b=r.body;
      assert.equal(b.active_host,players[0]);assert.equal(b.participant_count,3);assert.equal(b.handoff_occurred,true);assert.deepEqual(b.active_participants,[players[0],players[1],players[3]]);assert.equal(b.status,'active');
      assert.equal(b.chat_room_id,'chat-cs-session-101');assert.equal(b.composite_playback_url,'http://localhost:8888/costream/cs-session-101/index.m3u8');assert.equal(b.signature,signDay2(b.session_id,sessionPayload(b)));
      const replay=await session(sessionRequest({host_player_id:players[2],simulate_host_drop:true}));assert.equal(replay.status,200);assert.deepEqual(replay.body,b);
    });
    await t.test('replaying an earlier request does not undo a later host handoff',async()=>{
      const replay=await session(sessionRequest());assert.equal(replay.status,200);assert.equal(replay.body.active_host,players[0]);assert.equal(replay.body.handoff_occurred,false);
      const saved=(await pool.query('SELECT data FROM costream_sessions WHERE session_id=$1',['cs-session-101'])).rows[0].data.response;
      assert.equal(saved.handoff_occurred,true);assert.equal(saved.participant_count,3);
    });
    await t.test('sole host drop terminates cleanly with null host and no handoff',async()=>{
      const request=sessionRequest({session_id:'solo-drop',participants:[players[0]],simulate_host_drop:true,layout:'solo'});
      const r=await session(request);assert.equal(r.status,201);const b=r.body;
      assert.equal(b.status,'terminated');assert.equal(b.active_host,null);assert.equal(b.handoff_occurred,false);assert.equal(b.participant_count,0);assert.deepEqual(b.active_participants,[]);assert.equal(b.signature,signDay2(b.session_id,sessionPayload(b)));
      assert.equal((await session(request)).status,200);error(await post('/internal/media/auth',{action:'read',path:'costream/solo-drop'}),404,'STREAM_NOT_FOUND');
    });
    await t.test('concurrent identical sessions produce one creation and nine exact replays',async()=>{
      const request=sessionRequest({session_id:'concurrent-session',simulate_host_drop:true});
      const results=await Promise.all(Array.from({length:10},()=>session(request)));
      assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(results.filter(r=>r.status===200).length,9);for(const r of results)assert.deepEqual(r.body,results[0].body);
    });
    await t.test('malformed and oversized Day 2 requests use the global envelope',async()=>{
      for(const path of ['/audit/v1/stream/key','/audit/v1/costream/session']){
        const malformed=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});error({status:malformed.status,body:await malformed.json()},400,'VALIDATION_ERROR','body');
        error(await post(path,{padding:'x'.repeat(1024*1024)}),413,'PAYLOAD_TOO_LARGE');
      }
    });
    await t.test('hostile player IDs are parameters and never damage tables',async()=>{
      error(await stream(keyRequest({player_id:"'; DROP TABLE players; --"})),404,'PLAYER_NOT_FOUND');
      assert.ok((await pool.query('SELECT count(*)::int AS n FROM players')).rows[0].n>=4);
    });
    await t.test('reset clears every key and co-stream while restoring empty carts and QR counts',async()=>{
      await pool.query("UPDATE user_carts SET data='{}'");await pool.query("UPDATE qr_mappings SET data=jsonb_set(data,'{scan_count}','7')");await reset();
      for(const table of ['stream_keys','creator_streams','costream_sessions'])assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0);
      assert.deepEqual((await pool.query('SELECT data FROM user_carts')).rows[0].data,{items:[]});assert.ok((await pool.query('SELECT data FROM qr_mappings')).rows.every(r=>r.data.scan_count===0));
    });
  } finally {await reset();await pool.end();}
});
