import test from 'node:test';
import assert from 'node:assert/strict';
import {moderate} from '../src/moderation.js';
import {createDLQ} from '../src/dlq.js';
import {renderMetrics, METRICS_CONTENT_TYPE} from '../src/metrics.js';
import {anonymize, createPrivacy, redactName, isRedacted, redactRecord, isTokenRevoked} from '../src/privacy.js';
import {registerB3Routes, validateModeration} from '../src/day2-b3-routes.js';

const message = (text, sender = 'sender-1', message_id = 'msg-1') => ({message_id, sender, text});
const sample = [
  message('Clean sports commentary', 'user-guest-1', 'msg-1'),
  message('Watch this illegal stream b@d_w0rd now!', 'user-spammer', 'msg-2'),
  message('GOAL! AAAA!!!', 'user-flooder', 'msg-3'),
];
const expected = {
  filtered_messages: [
    {...sample[0], flagged: false, reason: null},
    {...sample[1], text: 'Watch this illegal stream *** now!', flagged: true, reason: 'profanity_leetspeak'},
  ],
  kicked_users: ['user-spammer'], muted_users: ['user-flooder'],
};
const invalid = error => error.status === 400 && error.code === 'VALIDATION_ERROR' && Array.isArray(error.details.fields);

test('Section 5.8 example matches exactly; input is unchanged', () => {
  const before = structuredClone(sample);
  assert.deepEqual(moderate(sample), expected);
  assert.deepEqual(sample, before);
});
for (const token of ['b@d_w0rd','bad_word','p.0.r.n','p0rn','s!c@m','sc@m',
  'f*u*c*k','a$$h0le','sh1t','b!tch','idiot_spam','B-A-D-W-O-R-D','b\u200ba\u200cd\u200dw\u2060o\ufeffrd']) {
  test('masks obfuscated token in place: ' + token, () => {
    const output = moderate([message('Watch (' + token + '), now!')]);
    assert.equal(output.filtered_messages[0].text, 'Watch (***), now!');
    assert.equal(output.filtered_messages[0].reason, 'profanity_leetspeak');
    assert.deepEqual(output.kicked_users, ['sender-1']);
  });
}
test('masks every offending token and preserves punctuation and spacing', () => {
  assert.equal(moderate([message('BADWORD!  porn, sc@m; idiot_spam.')]).filtered_messages[0].text, '***!  ***, ***; ***.');
});
test('does not censor substrings inside innocent words', () => {
  const clean = 'scamper, skill, assignment, badwordish, pornography';
  assert.equal(moderate([message(clean)]).filtered_messages[0].text, clean);
});
for (const text of ['AAAA','aAaA','!!!!','???','!!!','GOAL! AAAA!!!','....','\n\n\n\n','😀😀😀😀']) {
  test('flood dropped and muted only: ' + JSON.stringify(text), () => {
    assert.deepEqual(moderate([message(text)]), {filtered_messages: [], kicked_users: [], muted_users: ['sender-1']});
  });
}
test('three ordinary repeats and two !/? remain allowed', () => {
  assert.equal(moderate([message('AAA! Goal!! Really??')]).filtered_messages.length, 1);
});
test('flood takes precedence when the same message also contains profanity', () => {
  assert.deepEqual(moderate([message('badword!!!')]), {filtered_messages: [], kicked_users: [], muted_users: ['sender-1']});
});
test('kick/mute lists deduplicate in order of first violation', () => {
  const output = moderate([message('porn','b'),message('scam','a'),message('shit','b'),
    message('AAAA','z'),message('???','y'),message('!!!','z')]);
  assert.deepEqual(output.kicked_users, ['b','a']);
  assert.deepEqual(output.muted_users, ['z','y']);
});
test('ten simultaneous moderation calls have isolated state and no rate limit', async () => {
  const results = await Promise.all(Array.from({length:10}, () => Promise.resolve().then(() => moderate(sample))));
  results.forEach(result => assert.deepEqual(result, expected));
  results[0].kicked_users.push('changed');
  assert.deepEqual(results[1].kicked_users, ['user-spammer']);
});
test('empty message batch produces empty arrays', () => {
  assert.deepEqual(moderate([]), {filtered_messages: [], kicked_users: [], muted_users: []});
});
test('malformed messages produce field-specific validation errors', () => {
  for (const input of [null, {}, [null], [message(4)], [{sender:'u',text:'ok'}], [message('ok','')]])
    assert.throws(() => moderate(input), invalid);
});
test('moderation body validation rejects bad types before invoking services', () => {
  const valid = {chat_room_id:'chat-1',incoming_messages:[]};
  for (const input of [null, [], {}, {...valid,chat_room_id:''}, {...valid,check_dlq:1},
    {...valid,simulate_failed_notifications:-1}, {...valid,simulate_failed_notifications:1.5},
    {...valid,simulate_failed_notifications:Infinity}]) assert.throws(() => validateModeration(input), invalid);
  assert.deepEqual(validateModeration(valid), {...valid,check_dlq:true,simulate_failed_notifications:0});
});

const getters = {activeWsConnections:()=>2,activeStreams:async()=>3,streamBitrateKbps:()=>1234.5,
  dlqDepth:()=>4,qrScans:()=>5};
test('Prometheus format contains five HELP/TYPE/value triples and correct MIME', async () => {
  const text = await renderMetrics(getters);
  assert.equal(METRICS_CONTENT_TYPE, 'text/plain; version=0.0.4');
  const values = {nascon_active_ws_connections:2,nascon_active_streams_total:3,
    nascon_stream_bitrate_kbps:1234.5,nascon_dlq_depth:4,nascon_qr_scans_total:5};
  for (const [name,value] of Object.entries(values)) {
    assert.ok(text.includes('# HELP ' + name + ' '));
    assert.ok(text.includes('# TYPE ' + name + (name === 'nascon_qr_scans_total' ? ' counter' : ' gauge')));
    assert.ok(text.split('\n').includes(name + ' ' + value));
  }
  assert.equal((text.match(/^# HELP /gm) ?? []).length,5);
  assert.ok(text.endsWith('\n'));
});
test('metric getters are fresh on each scrape and accept exact metric names', async () => {
  let count = 0;
  const current = {...getters,nascon_qr_scans_total:()=>++count};
  assert.match(await renderMetrics(current),/nascon_qr_scans_total 1\n/);
  assert.match(await renderMetrics(current),/nascon_qr_scans_total 2\n/);
});
test('invalid or missing metrics fail explicitly instead of inventing values', async () => {
  for (const value of [-1,NaN,Infinity]) await assert.rejects(renderMetrics({...getters,dlqDepth:()=>value}),TypeError);
  await assert.rejects(renderMetrics({}),TypeError);
});

// These SQL doubles test our transaction/retry protocol; they are not a claim of
// running PostgreSQL integration tests on Laptop 2. Laptop 1 runs real DB tests.
function queuePool() {
  const state = {events:[],tail:Promise.resolve(),sql:[],releases:0,failInsert:false};
  return {state, async connect() {
    let unlock, pending;
    return {async query(sql,args=[]) {
      state.sql.push(sql);
      if (sql === 'SELECT pg_advisory_xact_lock(5506)') {
        const previous = state.tail;
        state.tail = new Promise(resolve => {unlock=resolve;});
        await previous; pending=structuredClone(state.events);
      } else if (sql.startsWith('INSERT INTO day2_dlq')) {
        if (state.failInsert) throw new Error('insert failure');
        pending.push(...JSON.parse(args[0]));
      } else if (sql === 'SELECT data FROM day2_dlq ORDER BY sequence') return {rows:pending.map(data=>({data}))};
      else if (sql === 'SELECT count(*) AS count FROM day2_dlq') return {rows:[{count:String(pending.length)}]};
      else if (sql === 'DELETE FROM day2_dlq') pending=[];
      else if (sql === 'COMMIT') {state.events=pending;unlock?.();unlock=undefined;}
      else if (sql === 'ROLLBACK') {unlock?.();unlock=undefined;}
      return {rows:[],rowCount:0};
    }, release() {state.releases++; unlock?.();}};
  }};
}
test('DLQ retries exactly three times with exponential tiny delays and persists events', async () => {
  const pool = queuePool(), attempts=[], waits=[];
  const dlq = createDLQ(pool,{deliver:async(event,attempt)=>{attempts.push(attempt);throw Error('no');},sleep:async ms=>waits.push(ms)});
  const result = await dlq.enqueue(2);
  assert.deepEqual(attempts,[1,2,3,1,2,3]);
  assert.deepEqual(waits,[1,2,1,2]);
  assert.equal(result.queue_depth,2);
  assert.ok(result.undelivered_events.every(event=>event.attempts===3 && event.event_id));
  assert.equal(await dlq.depth(),2);
  assert.equal((await dlq.undelivered()).length,2);
  const recreated = createDLQ(pool,{sleep:async()=>{}});
  assert.equal((await recreated.snapshot()).queue_depth,2);
  assert.ok(pool.state.sql.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS day2_dlq')));
  assert.ok(pool.state.sql.some(sql=>sql.includes('AFTER TRUNCATE ON app_state')));
});
test('successful retry is not queued and never exceeds max attempts', async () => {
  const calls=[], pool=queuePool();
  const dlq=createDLQ(pool,{deliver:async(_event,attempt)=>{calls.push(attempt);if(attempt<2)throw Error('retry');},sleep:async()=>{}});
  assert.equal((await dlq.enqueue(1)).queue_depth,0);
  assert.deepEqual(calls,[1,2]);
});
test('ten concurrent DLQ enqueues serialize and preserve exact depth without lost events', async () => {
  const pool=queuePool(), dlq=createDLQ(pool,{sleep:async()=>{}});
  const results=await Promise.all(Array.from({length:10},()=>dlq.enqueue(2)));
  assert.equal(await dlq.depth(),20);
  assert.equal(new Set((await dlq.undelivered()).map(event=>event.event_id)).size,20);
  assert.deepEqual(results.map(result=>result.queue_depth).sort((a,b)=>a-b),[2,4,6,8,10,12,14,16,18,20]);
});
test('DLQ clear empties persisted state and invalid counts fail', async () => {
  const dlq=createDLQ(queuePool(),{sleep:async()=>{}});
  await dlq.enqueue(1); await dlq.clear();
  assert.deepEqual(await dlq.snapshot(),{queue_depth:0,undelivered_events:[]});
  for (const count of [-1,1.5,NaN,'2']) await assert.rejects(dlq.enqueue(count),TypeError);
});
test('DLQ errors roll back and release the connection', async () => {
  const pool=queuePool(),dlq=createDLQ(pool,{sleep:async()=>{}});
  await dlq.init();pool.state.failInsert=true;
  await assert.rejects(dlq.enqueue(1),/insert failure/);
  assert.equal(pool.state.events.length,0);
  assert.ok(pool.state.sql.includes('ROLLBACK'));
  assert.equal(pool.state.releases,2);
});

function privacyPool({exists=true,fail=false}={}) {
  const calls=[], registry=new Map();let released=false;
  const state={registry,guest:{valid:true,registered_user_id:'player-alpha-1'},exists};
  function read(sql,args,current=registry) {
    if(sql.startsWith('SELECT aliases,name_hashes FROM privacy_redactions'))return {rows:current.has(args[0])?[current.get(args[0])]:[]};
    if(sql.startsWith('SELECT player_id FROM players'))return {rows:state.exists?[{player_id:'player-alpha-1'}]:[]};
    if(sql.startsWith('SELECT user_id,player_id FROM users'))return {rows:state.exists?[{user_id:'user-player',player_id:'player-alpha-1'}]:[]};
    if(sql.startsWith('SELECT data FROM player_profiles'))return {rows:[{data:{name:'Ali Ahmed',social_handles:{instagram:'private'}}}]};
    if(sql.startsWith('SELECT data FROM roster_history'))return {rows:[{data:{before:{player_id:'player-alpha-1',name:'Former Name'},after:{player_id:'player-alpha-1',name:'Ali Ahmed'}}}]};
    if(sql.trimStart().startsWith('SELECT data FROM rosters'))return {rows:[{data:{players:[{player_id:'player-alpha-1',name:'Ali Ahmed'}]}}]};
    if(sql.startsWith('SELECT data FROM guest_tokens'))return {rows:[{data:state.guest}]};
    if(sql.startsWith('SELECT user_id FROM privacy_redactions')) {
      let found;
      if(sql.includes('ANY($1'))found=args[0].find(id=>current.has(id));
      else if(current.has(args[0]))found=args[0];
      else if(args[1])found=[...current.keys()].find(id=>current.get(id).name_hashes.includes(args[1]));
      return {rows:found?[{user_id:found}]:[]};
    }
    return {rows:[],rowCount:1};
  }
  return {calls,state,get released(){return released;},
    async query(sql,args=[]) {calls.push({sql,args});return read(sql,args);},
    async connect(){let pending;
      return {async query(sql,args=[]) {
        calls.push({sql,args});
        if(sql==='BEGIN')pending=structuredClone(registry);
        if(sql==='COMMIT'){registry.clear();for(const [key,value] of pending)registry.set(key,value);}
        if(sql.trimStart().startsWith('INSERT INTO privacy_redactions'))
          pending.set(args[0],{aliases:args[1],name_hashes:args[2],redacted_at:'original-timestamp'});
        if(fail&&sql.includes('UPDATE guest_tokens'))throw Error('database failure');
        if(sql.includes('UPDATE guest_tokens'))state.guest={valid:false,invalidated:true,anonymized:true};
        return read(sql,args,pending);
      },release(){released=true;}};
    }};
}
test('privacy returns exact shape, clears identity fields and invalidates linked tokens atomically', async () => {
  const pool=privacyPool();
  assert.deepEqual(await anonymize(pool,'player-alpha-1'),{
    user_id:'player-alpha-1',status:'anonymized',pii_retained:false,tokens_wiped:true});
  const account=pool.calls.find(call=>call.sql.startsWith('UPDATE users'));
  assert.equal(account.args[0],'user-player');
  assert.match(account.args[1],/^anonymized-[a-f0-9]{64}@invalid$/);
  assert.match(account.args[2],/^!anonymized-/);
  const revoke=pool.calls.find(call=>call.sql.includes('UPDATE guest_tokens'));
  assert.ok(revoke.sql.includes('"valid":false'));
  assert.ok(revoke.args[0].includes('user-player'));
  assert.ok(revoke.args[0].includes('player-alpha-1'));
  assert.ok(pool.calls.some(call=>call.sql.includes('UPDATE player_profiles')));
  assert.ok(pool.calls.some(call=>call.sql.includes('UPDATE rosters')));
  assert.equal(pool.calls.at(-1).sql,'COMMIT');
  assert.equal(pool.released,true);
});
test('privacy unknown id returns 404 PLAYER_NOT_FOUND with rollback', async () => {
  const pool=privacyPool({exists:false});
  await assert.rejects(anonymize(pool,'missing'),error=>error.status===404&&error.code==='PLAYER_NOT_FOUND');
  assert.equal(pool.calls.at(-1).sql,'ROLLBACK');
  assert.ok(!pool.calls.some(call=>call.sql.startsWith('UPDATE')));
  assert.equal(pool.released,true);
});
test('privacy failure rolls back instead of returning success', async () => {
  const pool=privacyPool({fail:true});
  await assert.rejects(anonymize(pool,'player-alpha-1'),/database failure/);
  assert.equal(pool.calls.at(-1).sql,'ROLLBACK');
  assert.equal(pool.released,true);
});
test('privacy factory binds pool and rejects blank identifiers', async () => {
  assert.equal((await createPrivacy(privacyPool()).anonymize('player-alpha-1')).tokens_wiped,true);
  await assert.rejects(anonymize(privacyPool(),''),invalid);
});

function appDouble() {
  const handlers=new Map(),middleware=[];
  const app={locals:{},use(fn){middleware.push(fn);}};
  for(const method of ['post','get','delete'])app[method]=(path,fn)=>handlers.set(method+' '+path,fn);
  return {app,middleware,async call(method,path,request={}) {
    const response={statusCode:200,headers:{},status(code){this.statusCode=code;return this;},
      set(name,value){this.headers[name]=value;return this;},json(value){this.body=value;return this;},
      send(value){this.body=value;return this;}};
    await handlers.get(method+' '+path)(request,response,error=>{throw error;});
    return response;
  }};
}
test('moderation route signs exactly the required fields and produces the sample response', async () => {
  const fixture=appDouble(), signed=[];
  registerB3Routes(fixture.app,{pool:{},dlq:{snapshot:async()=>({queue_depth:0,undelivered_events:[]})},
    signDay2:(id,payload)=>{signed.push({id,payload});return 'unit-signature';}});
  const response=await fixture.call('post','/audit/v1/moderation/test',{body:{chat_room_id:'chat-cs-session-101',incoming_messages:sample}});
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.body,{chat_room_id:'chat-cs-session-101',...expected,
    dlq_status:{queue_depth:0,undelivered_events:[]},signature:'unit-signature'});
  assert.deepEqual(signed,[{id:'chat-cs-session-101',payload:{
    chat_room_id:'chat-cs-session-101',flagged_count:1,kicked_users:['user-spammer'],queue_depth:0}}]);
});
test('ten concurrent route requests stay deduplicated, with no cross-request rate limit', async () => {
  const fixture=appDouble();
  registerB3Routes(fixture.app,{pool:{},dlq:{snapshot:async()=>({queue_depth:0,undelivered_events:[]})},signDay2:()=> 'signature'});
  const responses=await Promise.all(Array.from({length:10},()=>fixture.call('post','/audit/v1/moderation/test',{
    body:{chat_room_id:'room',incoming_messages:[message('porn','user-spammer'),message('scam','user-spammer')]}})));
  responses.forEach(response=>{assert.equal(response.statusCode,200);assert.deepEqual(response.body.kicked_users,['user-spammer']);});
});
test('route enqueues requested failures even when check_dlq=false', async () => {
  const fixture=appDouble();let requested;
  registerB3Routes(fixture.app,{pool:{},dlq:{enqueue:async count=>{requested=count;return {queue_depth:count,undelivered_events:[]};}},signDay2:()=> 'signature'});
  const response=await fixture.call('post','/audit/v1/moderation/test',{
    body:{chat_room_id:'room',incoming_messages:[],check_dlq:false,simulate_failed_notifications:3}});
  assert.equal(requested,3);assert.equal(response.body.dlq_status.queue_depth,3);
});
test('route invalid bodies return standard 400 envelope without touching DB', async () => {
  const fixture=appDouble();
  registerB3Routes(fixture.app,{pool:{}});
  const response=await fixture.call('post','/audit/v1/moderation/test',{body:{chat_room_id:5}});
  assert.equal(response.statusCode,400);assert.equal(response.body.error.code,'VALIDATION_ERROR');
  assert.ok(Array.isArray(response.body.error.details.fields));
});
test('metrics route returns declared content type and injected current measurements', async () => {
  const fixture=appDouble();
  registerB3Routes(fixture.app,{pool:{},metrics:getters});
  const response=await fixture.call('get','/metrics');
  assert.equal(response.statusCode,200);
  assert.equal(response.headers['Content-Type'],METRICS_CONTENT_TYPE);
  assert.match(response.body.toString(),/nascon_stream_bitrate_kbps 1234\.5/);
});
test('privacy route delegates exact user id and returns standard 404', async () => {
  const fixture=appDouble();
  registerB3Routes(fixture.app,{pool:privacyPool({exists:false})});
  const response=await fixture.call('delete','/audit/v1/privacy/user/:user_id',{params:{user_id:'missing'}});
  assert.equal(response.statusCode,404);assert.equal(response.body.error.code,'PLAYER_NOT_FOUND');
});
test('malformed JSON parser errors return standard validation envelope', () => {
  const fixture=appDouble();registerB3Routes(fixture.app,{pool:{}});
  let code,body;
  const res={status(value){code=value;return this;},json(value){body=value;return this;}};
  fixture.middleware.find(fn=>fn.length===4)({type:'entity.parse.failed'}, {},res,()=>assert.fail('must handle'));
  assert.equal(code,400);assert.equal(body.error.code,'VALIDATION_ERROR');
});

test('privacy registry is idempotent, stores hashed former names and leaves immutable rows/triggers untouched', async () => {
  const pool=privacyPool();
  await anonymize(pool,'player-alpha-1');
  const first=structuredClone(pool.state.registry);
  assert.equal((await anonymize(pool,'player-alpha-1')).status,'anonymized');
  assert.equal(pool.state.registry.size,2);
  assert.equal(pool.state.registry.get('player-alpha-1').redacted_at,first.get('player-alpha-1').redacted_at);
  const writes=pool.calls.map(call=>call.sql).filter(sql=>/^\\s*(UPDATE|DELETE|ALTER|TRUNCATE)/i.test(sql));
  assert.ok(!writes.some(sql=>/roster_history|\\bevents\\b/i.test(sql)));
  assert.ok(!pool.calls.some(call=>/reject_roster_history_mutation|reject_event_mutation/.test(call.sql)));
  assert.ok(pool.state.registry.get('player-alpha-1').name_hashes.every(hash=>/^[a-f0-9]{64}$/.test(hash)));
});
test('read-time helpers hide current/former names and ids without mutating history', async () => {
  const pool=privacyPool();createPrivacy(pool);await anonymize(pool,'player-alpha-1');
  assert.equal(await isRedacted('player-alpha-1'),true);
  assert.equal(await isRedacted('not-redacted'),false);
  assert.equal(await redactName('Ali Ahmed'),'Anonymized user');
  assert.equal(await redactName('  FORMER NAME '),'Anonymized user');
  assert.equal(await redactName('player-alpha-1'),'Anonymized user');
  assert.equal(await redactName('Other player'),'Other player');
  const original={player_id:'player-alpha-1',name:'Ali Ahmed',email:'private@example.test',audit_id:'au-001',sequence:3,
    before:{player_id:'player-alpha-1',name:'Former Name',squad_id:'squad-old'}};
  const redacted=await redactRecord(original,pool);
  assert.equal(redacted.name,'Anonymized user');assert.equal(redacted.email,null);
  assert.equal(redacted.before.name,'Anonymized user');assert.equal(redacted.before.squad_id,'squad-old');
  assert.equal(redacted.sequence,3);assert.equal(original.name,'Ali Ahmed');
});
test('privacy redacts mutable snapshots, stable anonymized email and null social fields', async () => {
  const pool=privacyPool();await anonymize(pool,'player-alpha-1');
  const rosterQueries=pool.calls.filter(call=>call.sql.includes('UPDATE rosters'));
  assert.deepEqual(rosterQueries.map(call=>call.args[2]),['players','initial_players']);
  assert.ok(rosterQueries.every(call=>call.sql.includes('Anonymized user')));
  const profile=pool.calls.find(call=>call.sql.includes('UPDATE player_profiles'));
  assert.ok(profile.sql.includes("'social_handles',null"));
  const email=pool.calls.find(call=>call.sql.startsWith('UPDATE users')).args[1];
  await anonymize(pool,'player-alpha-1');
  assert.equal(pool.calls.filter(call=>call.sql.startsWith('UPDATE users')).at(-1).args[1],email);
});
test('blocklist revokes every JWT for erased subjects/players and guest/viewer tokens', async () => {
  const pool=privacyPool();await anonymize(pool,'player-alpha-1');
  const jwt=claims=>'header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
  assert.equal(await isTokenRevoked('Bearer '+jwt({sub:'user-player',jti:'first'}),pool),true);
  assert.equal(await isTokenRevoked('Bearer '+jwt({sub:'user-player',jti:'second'}),pool),true);
  assert.equal(await isTokenRevoked('Bearer '+jwt({sub:'other',player_id:'player-alpha-1'}),pool),true);
  assert.equal(await isTokenRevoked('Bearer '+jwt({sub:'other'}),pool),false);
  assert.equal(await isTokenRevoked('Bearer guest_anon_tok_7721',pool),true);
  assert.equal(await isTokenRevoked('Bearer viewer_token_1',pool),true);
  assert.equal(await isTokenRevoked('Bearer malformed',pool),false);
  assert.equal(await isTokenRevoked(undefined,pool),false);
});
test('revocation middleware blocks credentials before downstream handlers', async () => {
  const fixture=appDouble();
  registerB3Routes(fixture.app,{pool:{},privacy:{isTokenRevoked:async()=>true}});
  let status,body,called=false;
  const res={status(value){status=value;return this;},json(value){body=value;return this;}};
  await fixture.middleware[0]({method:'POST',path:'/api/v1/chat',headers:{authorization:'Bearer revoked'}},res,()=>{called=true;});
  assert.equal(status,401);assert.equal(body.error.code,'UNAUTHENTICATED');assert.equal(called,false);
});
test('repeat privacy deletion bypasses revoked-credential rejection', async () => {
  const fixture=appDouble();
  registerB3Routes(fixture.app,{pool:{},privacy:{isTokenRevoked:async()=>assert.fail('must bypass')}});
  let called=false;
  await fixture.middleware[0]({method:'DELETE',path:'/audit/v1/privacy/user/player-alpha-1'}, {},()=>{called=true;});
  assert.equal(called,true);
});
