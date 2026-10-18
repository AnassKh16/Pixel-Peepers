import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import pg from 'pg';
import {createClient} from 'redis';
import {signDay2} from '../src/day2-signature.js';
import {filterChatMessage} from '../src/chat-filter.js';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

const base=process.env.TEST_BASE_URL??'http://127.0.0.1:8080';
const guest='guest_anon_tok_7721',variant='var-jersey-001-L';
const call=async(path,body,token,method=body===undefined?'GET':'POST')=>{
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json(),headers:r.headers};
};
const bad=(r,status,code,field)=>{assert.equal(r.status,status,JSON.stringify(r.body));assert.equal(r.body.error.code,code);assert.deepEqual(Object.keys(r.body.error).sort(),['code','details','message']);if(field)assert.ok(r.body.error.details.fields.includes(field));};
const cart=(changes={})=>({guest_token:guest,registered_user_id:'player-alpha-1',guest_cart:[{variant_id:variant,quantity:1}],test_write_block:true,...changes});
const qrPayload=b=>({entity_id:b.entity_id,short_url:b.short_url,target_route:b.target_route});

for(const [text,expected]of [['Watch b@d_w0rd now!','Watch *** now!'],['p.0.r.n and sc@m','*** and ***'],['f*u*c*k sh1t b1tch a$$h0le idiot_spam','*** *** *** *** ***'],['Clean commentary','Clean commentary']])test(`shared chat filter: ${text}`,()=>assert.equal(filterChatMessage(text).text,expected));
for(const text of ['AAAA','aAaA','GOAL! AAAA!!!','wow!!!','why???'])test(`shared chat flood drops: ${text}`,()=>assert.equal(filterChatMessage(text).dropped,true));

test('Day 2 B2 live QR, guest boundary, atomic cart merge, public reads, and score streams',{skip:process.env.RUN_INTEGRATION!=='1',timeout:180000},async t=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const redis=createClient({url:process.env.REDIS_URL});await redis.connect();
  const reset=()=>call('/audit/v1/reset',{});
  const session=()=>call('/audit/v1/costream/session',{session_id:'cs-session-101',host_player_id:'player-alpha-1',participants:['player-alpha-1','player-alpha-2'],layout:'grid_2'});
  const event=(id,type,payload={})=>call('/audit/v1/events',{event_id:id,match_id:'match-m1',type,payload});
  const clearLimit=()=>redis.del('rate:127.0.0.1');
  try{
    await reset();
    await t.test('QR exact JSON, inspection, counting, stable URL, and signed live target',async()=>{
      let r=await call('/audit/v1/qr/match-m1?inspect=true');assert.equal(r.status,200);const b=r.body;
      assert.deepEqual(Object.keys(b).sort(),['entity_id','entity_type','entity_status','short_url','target_route','deep_link_uri','scan_count','export_formats','signature'].sort());
      assert.equal(b.entity_type,'match');assert.equal(b.entity_status,'in_progress');assert.equal(b.scan_count,0);assert.equal(b.short_url,'http://localhost:8080/q/m1-live');assert.equal(b.target_route,'/web/matches/match-m1/live');assert.equal(b.deep_link_uri,'nascon://entity/match-m1');assert.equal(b.signature,signDay2('match-m1',qrPayload(b)));
      assert.deepEqual(b.export_formats,Object.fromEntries(['svg','png','pdf'].map(f=>[f,`http://localhost:8080/audit/v1/qr/match-m1/export.${f}`])));
      r=await call('/audit/v1/qr/match-m1');assert.equal(r.body.scan_count,1);assert.equal((await call('/audit/v1/qr/match-m1?inspect=true')).body.scan_count,1);
      assert.equal((await call('/audit/v1/qr/match-m1')).body.scan_count,2);
    });
    await t.test('match_end immediately changes target and signature while printed URL stays constant',async()=>{
      const before=(await call('/audit/v1/qr/match-m1?inspect=true')).body;
      assert.equal((await event('b2-end','match_end')).status,201);
      const after=(await call('/audit/v1/qr/match-m1?inspect=true')).body;
      assert.equal(after.entity_status,'completed');assert.equal(after.target_route,'/web/matches/match-m1/vod');assert.equal(after.short_url,before.short_url);assert.notEqual(after.signature,before.signature);assert.equal(after.signature,signDay2('match-m1',qrPayload(after)));
      await reset();
    });
    for(const [status,suffix]of [['upcoming','preview'],['in_progress','live'],['completed','vod'],['postponed','notice?state=postponed'],['cancelled','notice?state=cancelled'],['abandoned','notice?state=abandoned']])await t.test(`live metadata status ${status} changes QR immediately`,async()=>{
      await pool.query("UPDATE matches SET data=jsonb_set(data,'{status}',to_jsonb($2::text)) WHERE match_id=$1",['match-m1',status]);
      const b=(await call('/audit/v1/qr/match-m1?inspect=true')).body;assert.equal(b.entity_status,status);assert.equal(b.target_route,`/web/matches/match-m1/${suffix}`);assert.equal(b.short_url,'http://localhost:8080/q/m1-live');assert.equal(b.signature,signDay2('match-m1',qrPayload(b)));
    });
    await t.test('players, clubs, and new co-streams resolve with stable generated mappings',async()=>{
      await reset();await session();
      for(const [id,type,path]of [['player-alpha-1','player','/web/players/player-alpha-1'],['club-alpha-1','club','/web/clubs/club-alpha-1'],['cs-session-101','costream','/web/costream/cs-session-101'],['demo-match-alpha-4','match','/web/matches/demo-match-alpha-4/preview']]){
        const r=await call(`/audit/v1/qr/${id}?inspect=true`);assert.equal(r.status,200);assert.equal(r.body.entity_type,type);assert.equal(r.body.target_route,path);assert.equal(r.body.scan_count,0);assert.equal(r.body.signature,signDay2(id,qrPayload(r.body)));
        assert.equal((await call(`/audit/v1/qr/${id}?inspect=true`)).body.short_url,r.body.short_url);
      }
    });
    await t.test('short URL redirects by current state and counts one scan',async()=>{
      await reset();
      let r=await fetch(base+'/q/m1-live',{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/web/matches/match-m1/live');assert.equal((await call('/audit/v1/qr/match-m1?inspect=true')).body.scan_count,1);
      await event('b2-short-end','match_end');r=await fetch(base+'/q/m1-live',{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/web/matches/match-m1/vod');
      await reset();
    });
    await t.test('unknown entities, short codes, exports and hostile IDs return QR_NOT_FOUND',async()=>{
      for(const path of ['/audit/v1/qr/missing','/q/missing','/audit/v1/qr/missing/export.png','/audit/v1/qr/match-m1/export.gif',"/audit/v1/qr/';DROP%20TABLE%20players;--"])bad(await call(path),404,'QR_NOT_FOUND');
    });
    await t.test('concurrent scans do not lose counts and telemetry stores only family and UTC hour',async()=>{
      await reset();
      const ua='Mozilla/5.0 (iPhone; Mobile) UNIQUE-UA-DO-NOT-STORE';
      const results=await Promise.all(Array.from({length:20},()=>fetch(base+'/audit/v1/qr/match-m1',{headers:{'User-Agent':ua,'X-Forwarded-For':'203.0.113.99'}}).then(r=>r.json())));
      assert.deepEqual(results.map(r=>r.scan_count).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+1));
      const rows=(await pool.query('SELECT * FROM qr_scan_telemetry')).rows;assert.equal(rows.length,1);assert.equal(rows[0].device_family,'mobile');assert.equal(Number(rows[0].scan_count),20);assert.equal(new Date(rows[0].utc_hour).getUTCMinutes(),0);assert.equal(new Date(rows[0].utc_hour).getUTCSeconds(),0);
      assert.deepEqual(Object.keys(rows[0]).sort(),['entity_id','device_family','utc_hour','scan_count'].sort());assert.ok(!JSON.stringify(rows).includes('UNIQUE-UA'));assert.ok(!JSON.stringify(rows).includes('203.0.113.99'));
      await call('/audit/v1/qr/match-m1');assert.equal(Number((await pool.query("SELECT scan_count FROM qr_scan_telemetry WHERE device_family='desktop'")).rows[0].scan_count),1);
      await reset();assert.equal((await pool.query('SELECT * FROM qr_scan_telemetry')).rowCount,0);
    });
    await t.test('SVG, PNG and PDF are real exports with exact content types and magic bytes',async()=>{
      for(const [format,type]of [['svg','image/svg+xml'],['png','image/png'],['pdf','application/pdf']]){
        const r=await fetch(base+`/audit/v1/qr/match-m1/export.${format}`);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),type);const bytes=Buffer.from(await r.arrayBuffer());
        if(format==='svg'){assert.ok(bytes.toString().startsWith('<svg'));assert.ok(bytes.toString().includes('<path'));}
        if(format==='png'){assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(bytes.toString('ascii',12,16),'IHDR');assert.equal(bytes.readUInt32BE(16),512);}
        if(format==='pdf'){
          assert.equal(bytes.toString('ascii',0,5),'%PDF-');const doc=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true,disableFontFace:true}).promise;
          const page=await doc.getPage(1),text=(await page.getTextContent()).items.map(i=>i.str).join(' ');assert.ok(text.includes('match-m1'));assert.ok(text.includes('http://localhost:8080/q/m1-live'));await doc.destroy();
        }
      }
      assert.equal((await call('/audit/v1/qr/match-m1?inspect=true')).body.scan_count,0);
    });
    await t.test('issued guest tokens are unique, persistent, read-only and short-lived',async()=>{
      await clearLimit();const first=await call('/api/v1/guest/token',{}),second=await call('/api/v1/guest/token',{});
      assert.equal(first.status,201);assert.match(first.body.guest_token,/^guest_anon_tok_[a-f0-9]+$/);assert.notEqual(first.body.guest_token,second.body.guest_token);assert.equal(first.body.role,'guest');assert.equal(first.body.read_only,true);assert.ok(Date.parse(first.body.expires_at)>Date.now());
      const saved=(await pool.query('SELECT data FROM guest_tokens WHERE guest_token=$1',[first.body.guest_token])).rows[0].data;assert.equal(saved.valid,true);assert.equal(saved.merged,false);
    });
    for(const path of ['/api/v1/chat','/audit/v1/checkout','/audit/v1/events','/api/v1/follow','/api/v1/players/player-alpha-1/follow','/audit/v1/roster/setup','/audit/v1/roster/transfer','/api/v1/offline-sync','/audit/v1/stream/key'])await t.test(`guest write guard: ${path}`,async()=>{
      const r=await call(path,{},guest);bad(r,403,'GUEST_WRITE_FORBIDDEN');assert.equal(r.body.error.details.guest_token,guest);assert.equal(r.headers.get('access-control-allow-origin'),'*');
    });
    await t.test('anonymous chat is forbidden rather than unauthenticated; guest boundary precedes bad JSON',async()=>{
      bad(await call('/api/v1/chat',{}),403,'GUEST_WRITE_FORBIDDEN');
      const r=await fetch(base+'/audit/v1/events',{method:'POST',headers:{Authorization:`Bearer ${guest}`,'Content-Type':'application/json'},body:'{'});bad({status:r.status,body:await r.json()},403,'GUEST_WRITE_FORBIDDEN');
      assert.equal((await call('/api/v1/auth/login',{email:'viewer@nascon.test',password:'Nascon@26'},guest)).status,200);
    });
    const invalid=[null,[],{},cart({guest_token:'bad'}),cart({registered_user_id:7}),cart({guest_cart:[]}),cart({guest_cart:Array(11).fill({variant_id:variant,quantity:1})}),cart({guest_cart:[null]}),cart({guest_cart:[{variant_id:7,quantity:1}]}),cart({guest_cart:[{variant_id:variant,quantity:0}]}),cart({guest_cart:[{variant_id:variant,quantity:1.5}]}),cart({guest_cart:[{variant_id:variant,quantity:'1'}]}),cart({test_write_block:null})];
    for(const [i,body]of invalid.entries())await t.test(`cart schema validation ${i+1}`,async()=>bad(await call('/audit/v1/guest/cart-merge',body),400,'VALIDATION_ERROR'));
    await t.test('cart schema precedes missing refs, player precedes variant, variants precede stock',async()=>{
      bad(await call('/audit/v1/guest/cart-merge',cart({registered_user_id:'missing',guest_cart:[{variant_id:'missing',quantity:0}]})),400,'VALIDATION_ERROR');
      bad(await call('/audit/v1/guest/cart-merge',cart({registered_user_id:'missing',guest_cart:[{variant_id:'missing',quantity:1}]})),404,'PLAYER_NOT_FOUND');
      bad(await call('/audit/v1/guest/cart-merge',cart({guest_cart:[{variant_id:variant,quantity:99},{variant_id:'missing',quantity:1}]})),404,'VARIANT_NOT_FOUND');
    });
    await t.test('merge exact shape, genuine write-block check, catalogue prices, full signature, and no reservation',async()=>{
      await reset();const r=await call('/audit/v1/guest/cart-merge',cart(),guest);assert.equal(r.status,200);const b=r.body;
      assert.deepEqual(Object.keys(b).sort(),['guest_token','write_block_verified','write_rejection_code','cart_merged','active_cart','signature'].sort());assert.equal(b.write_block_verified,true);assert.equal(b.write_rejection_code,403);assert.equal(b.cart_merged,true);
      assert.deepEqual(b.active_cart,{user_id:'player-alpha-1',currency:'PKR',total_items:1,subtotal_minor:450000,items:[{variant_id:variant,quantity:1,unit_price_minor:450000}]});
      assert.equal(b.signature,signDay2(guest,{cart_merged:true,guest_token:guest,registered_user_id:'player-alpha-1',total_items:1,write_rejection_code:403}));
      assert.deepEqual((await call('/audit/v1/inventory/'+variant)).body,{variant_id:variant,stock:5,reserved:0});assert.equal((await pool.query('SELECT data FROM guest_tokens WHERE guest_token=$1',[guest])).rows[0].data.valid,false);
    });
    await t.test('identical merge replay returns stored receipt even if stock changes; changed user/cart conflicts',async()=>{
      const first=(await call('/audit/v1/guest/cart-merge',cart())).body;
      await pool.query('UPDATE variants SET stock=0 WHERE variant_id=$1',[variant]);assert.deepEqual((await call('/audit/v1/guest/cart-merge',cart({test_write_block:false}))).body,first);await pool.query('UPDATE variants SET stock=5 WHERE variant_id=$1',[variant]);
      bad(await call('/audit/v1/guest/cart-merge',cart({registered_user_id:'player-alpha-2'})),409,'GUEST_TOKEN_ALREADY_MERGED');
      bad(await call('/audit/v1/guest/cart-merge',cart({guest_cart:[{variant_id:variant,quantity:2}]})),409,'GUEST_TOKEN_ALREADY_MERGED');
      assert.equal((await pool.query('SELECT data FROM user_carts WHERE user_id=$1',['player-alpha-1'])).rows[0].data.total_items,1);
    });
    await t.test('sum repeated variants and existing cart; disabled write probe uses false and integer zero',async()=>{
      await reset();let r=await call('/audit/v1/guest/cart-merge',cart({guest_token:'guest_first',guest_cart:[{variant_id:variant,quantity:1},{variant_id:variant,quantity:1}],test_write_block:false}));assert.equal(r.status,200);assert.equal(r.body.write_block_verified,false);assert.equal(r.body.write_rejection_code,0);assert.equal(r.body.active_cart.total_items,2);assert.equal(r.body.active_cart.items.length,1);
      r=await call('/audit/v1/guest/cart-merge',cart({guest_token:'guest_second'}));assert.equal(r.body.active_cart.total_items,3);assert.equal(r.body.active_cart.subtotal_minor,1350000);
    });
    await t.test('OUT_OF_STOCK rolls back all cart/token changes and precedes changed-token conflict',async()=>{
      const before=(await pool.query('SELECT data FROM user_carts')).rows;
      const r=await call('/audit/v1/guest/cart-merge',cart({guest_token:'guest_reject',guest_cart:[{variant_id:variant,quantity:9}]}));bad(r,409,'OUT_OF_STOCK');assert.equal(r.body.error.details.variant_id,variant);assert.deepEqual((await pool.query('SELECT data FROM user_carts')).rows,before);assert.equal((await pool.query('SELECT * FROM guest_tokens WHERE guest_token=$1',['guest_reject'])).rowCount,0);
      bad(await call('/audit/v1/guest/cart-merge',cart({guest_token:'guest_first',guest_cart:[{variant_id:variant,quantity:9}]})),409,'OUT_OF_STOCK');
    });
    await t.test('twenty identical concurrent merges add once without double reservation',async()=>{
      await reset();const results=await Promise.all(Array.from({length:20},()=>call('/audit/v1/guest/cart-merge',cart())));assert.ok(results.every(r=>r.status===200));for(const r of results)assert.deepEqual(r.body,results[0].body);
      assert.equal(results[0].body.active_cart.total_items,1);assert.deepEqual((await call('/audit/v1/inventory/'+variant)).body,{variant_id:variant,stock:5,reserved:0});
    });
    await t.test('different guest tokens racing for one remaining cart slot cannot exceed stock',async()=>{
      await reset();await pool.query('UPDATE variants SET stock=1 WHERE variant_id=$1',[variant]);
      const results=await Promise.all(Array.from({length:10},(_,i)=>call('/audit/v1/guest/cart-merge',cart({guest_token:`guest_race_${i}`}))));assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409&&r.body.error.code==='OUT_OF_STOCK').length,9);assert.equal((await pool.query('SELECT data FROM user_carts WHERE user_id=$1',['player-alpha-1'])).rows[0].data.total_items,1);await reset();
    });
    await t.test('public GETs work without a token and with the seeded guest token',async()=>{
      await reset();await session();await clearLimit();
      for(const token of [undefined,guest])for(const path of ['/api/v1/matches/match-m1','/api/v1/matches/match-m1/summary','/api/v1/costream/cs-session-101','/api/v1/chat?chat_room_id=chat-cs-session-101','/api/v1/products','/api/v1/players/player-alpha-1','/api/v1/clubs/club-alpha-1'])assert.equal((await call(path,undefined,token)).status,200,path);
      const match=(await call('/api/v1/matches/match-m1')).body;assert.equal(match.score,'1 - 0');assert.equal(match.home.score,1);assert.equal(match.away.score,0);
      assert.deepEqual(Object.keys((await call('/api/v1/matches/match-m1/summary')).body).sort(),['match_id','status','home','away','score'].sort());
      assert.equal((await call('/api/v1/costream/cs-session-101')).body.chat_room_id,'chat-cs-session-101');
      const products=(await call('/api/v1/products')).body.products;assert.ok(products.some(p=>p.product_id==='prod-jersey-001'&&p.variants.some(v=>v.variant_id===variant)));
      const player=(await call('/api/v1/players/player-alpha-1')).body;assert.deepEqual(Object.keys(player).sort(),['player_id','club_id','name','position'].sort());
      const club=(await call('/api/v1/clubs/club-alpha-1')).body;assert.ok(!('tenant_id'in club));assert.equal(club.roster.length,12);assert.ok(club.roster.every(p=>!('parent_squad_id'in p)));
    });
    await t.test('member tenant isolation and original match body are preserved; invalid JWT is never downgraded',async()=>{
      await clearLimit();const tokens=(await call('/audit/v1/rbac-matrix',{})).body.tokens;
      for(const path of ['/api/v1/matches/demo-match-beta-1','/api/v1/clubs/club-beta-1','/api/v1/players/player-beta-1'])bad(await call(path,undefined,tokens.viewer),403,'FORBIDDEN');
      assert.deepEqual((await call('/api/v1/matches/match-m1',undefined,tokens.viewer)).body,(await call('/audit/v1/score/match-m1')).body);
      bad(await call('/api/v1/products',undefined,'tampered-token'),401,'UNAUTHENTICATED');bad(await call('/api/v1/me'),401,'UNAUTHENTICATED');assert.equal((await call('/api/v1/clubs/club-beta-1')).status,200);
    });
    await t.test('JWT chat stores masked messages with consecutive sequences and forces sender identity',async()=>{
      await clearLimit();const tokens=(await call('/audit/v1/rbac-matrix',{})).body.tokens;
      const first=await call('/api/v1/chat',{session_id:'cs-session-101',message_id:'chat-one',text:'Watch b@d_w0rd now!',sender:'spoofed'},tokens.viewer);assert.equal(first.status,201);assert.equal(first.body.sequence,1);assert.equal(first.body.sender,'user-viewer');assert.equal(first.body.text,'Watch *** now!');assert.equal(first.body.flagged,true);
      const replay=await call('/api/v1/chat',{session_id:'cs-session-101',message_id:'chat-one',text:'Watch b@d_w0rd now!'},tokens.viewer);assert.equal(replay.status,200);assert.deepEqual(replay.body,first.body);
      const results=await Promise.all(Array.from({length:10},(_,i)=>call('/api/v1/chat',{chat_room_id:'chat-cs-session-101',message_id:`parallel-${i}`,text:`Reaction ${i}`},tokens.player)));assert.ok(results.every(r=>r.status===201));assert.deepEqual(results.map(r=>r.body.sequence).sort((a,b)=>a-b),Array.from({length:10},(_,i)=>i+2));
      const messages=(await call('/api/v1/chat?chat_room_id=chat-cs-session-101',undefined,guest)).body.messages;assert.equal(messages.length,11);assert.equal(messages[0].text,'Watch *** now!');assert.deepEqual(messages.map(m=>m.sequence),Array.from({length:11},(_,i)=>i+1));
      bad(await call('/api/v1/chat',{session_id:'cs-session-101',message_id:'chat-one',text:'Changed'},tokens.viewer),409,'DUPLICATE_MESSAGE_ID');
      assert.equal((await call('/api/v1/chat',{session_id:'cs-session-101',text:'AAAA!!!'},tokens.viewer)).body.dropped,true);
      bad(await call('/api/v1/chat',{session_id:'cs-session-101',text:''},tokens.viewer),400,'VALIDATION_ERROR');bad(await call('/api/v1/chat'),400,'VALIDATION_ERROR');
    });
    await t.test('SSE is public with anonymous and guest-token callers and members retain tenant checks',async()=>{
      await clearLimit();
      for(const token of [undefined,guest]){
        const controller=new AbortController();const r=await fetch(base+'/api/v1/matches/match-m1/stream',{headers:token?{Authorization:`Bearer ${token}`}:{},signal:controller.signal});
        assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/event-stream/);const chunk=await r.body.getReader().read();assert.ok(Buffer.from(chunk.value).toString().includes('"score":"1 - 0"'));controller.abort();
      }
      const tokens=(await call('/audit/v1/rbac-matrix',{})).body.tokens;bad(await call('/api/v1/matches/demo-match-beta-1/stream',undefined,tokens.viewer),403,'FORBIDDEN');
    });
    await t.test('25 real WebSocket clients receive accepted scores, compensation, and status changes within 100 ms p95',async()=>{
      await reset();const sockets=[],messages=Array.from({length:25},()=>[]),pending=[];
      const url=base.replace(/^http/,'ws')+'/ws/matches/match-m1';
      try{
        await Promise.all(Array.from({length:25},async(_,i)=>{
          const ws=new WebSocket(url);sockets.push(ws);ws.on('message',bytes=>{const data=JSON.parse(bytes);messages[i].push({data,time:performance.now()});pending[i]?.(data);});await once(ws,'open');
        }));
        const waitFor=async(predicate)=>{
          await Promise.all(messages.map((list,i)=>list.some(entry=>predicate(entry.data))?Promise.resolve():new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error(`Socket ${i} did not receive score`)),2000);pending[i]=data=>{if(predicate(data)){clearTimeout(timer);pending[i]=null;resolve();}};
          })));
        };
        await waitFor(data=>data.version===2);
        const started=performance.now();assert.equal((await event('b2-ws-score','score',{team_id:'club-alpha-2',event_type:'goal'})).status,201);await waitFor(data=>data.version===3&&data.score==='1 - 1');
        const latencies=messages.map(list=>list.find(entry=>entry.data.version===3).time-started).sort((a,b)=>a-b);const p95=latencies[Math.ceil(latencies.length*0.95)-1];assert.ok(p95<100,`p95 ${p95.toFixed(1)} ms`);t.diagnostic(`25-client WebSocket p95: ${p95.toFixed(1)} ms`);
        assert.equal((await event('b2-ws-correct','compensation',{compensates:'b2-ws-score',reason:'Correction'})).status,201);await waitFor(data=>data.version===4&&data.score==='1 - 0');
        assert.equal((await event('b2-ws-end','match_end')).status,201);await waitFor(data=>data.version===5&&data.status==='completed');
        await pool.query("UPDATE matches SET data=jsonb_set(data,'{status}','\"postponed\"') WHERE match_id='match-m1'");await waitFor(data=>data.status==='postponed');
      }finally{await Promise.all(sockets.map(ws=>new Promise(resolve=>{if(ws.readyState===WebSocket.CLOSED)resolve();else{ws.once('close',resolve);ws.close();}})));}
      await reset();
    });
    await t.test('SSE receives a score committed by the other API process, then compensation and completion',async()=>{
      await reset();await clearLimit();
      const controller=new AbortController();let reader;
      try{
        const r=await fetch(base+'/api/v1/matches/match-m1/stream',{signal:controller.signal});assert.equal(r.status,200);reader=r.body.getReader();
        let buffer='';const queued=[];
        const until=async predicate=>{
          for(;;){
            while(queued.length){const value=queued.shift();if(predicate(value))return value;}
            let timer;
            const part=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SSE update timeout')),2000);})]).finally(()=>clearTimeout(timer));
            assert.equal(part.done,false);buffer+=Buffer.from(part.value).toString();
            let end;while((end=buffer.indexOf('\n\n'))!==-1){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=block.split('\n').find(line=>line.startsWith('data: '));if(line)queued.push(JSON.parse(line.slice(6)));}
          }
        };
        await until(value=>value.version===2);
        const started=performance.now();
        const producer=await fetch('http://127.0.0.1:8080/audit/v1/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event_id:'b2-cross-process',match_id:'match-m1',type:'score',payload:{team_id:'club-alpha-2',event_type:'goal'}})});assert.equal(producer.status,201);
        await until(value=>value.version===3&&value.score==='1 - 1');const elapsed=performance.now()-started;assert.ok(elapsed<100,`SSE delivery ${elapsed.toFixed(1)} ms`);t.diagnostic(`Cross-process SSE score delivery: ${elapsed.toFixed(1)} ms`);
        assert.equal((await event('b2-sse-correct','compensation',{compensates:'b2-cross-process',reason:'Correction'})).status,201);await until(value=>value.version===4&&value.score==='1 - 0');
        assert.equal((await event('b2-sse-end','match_end')).status,201);await until(value=>value.version===5&&value.status==='completed');
      }finally{controller.abort();await reader?.cancel().catch(()=>{});}
      await reset();
    });
    await t.test('public missing resources keep their specific 404 errors and missing SSE never opens',async()=>{
      await clearLimit();
      for(const [path,code]of [['/api/v1/matches/missing','MATCH_NOT_FOUND'],['/api/v1/matches/missing/summary','MATCH_NOT_FOUND'],['/api/v1/matches/missing/stream','MATCH_NOT_FOUND'],['/api/v1/players/missing','PLAYER_NOT_FOUND'],['/api/v1/clubs/missing','CLUB_NOT_FOUND'],['/api/v1/costream/missing','STREAM_NOT_FOUND']])bad(await call(path),404,code);
    });
    await t.test('public club output excludes private fields even inside home venue and staff',async()=>{
      await pool.query("UPDATE club_profiles SET data=data || $2::jsonb WHERE club_id=$1",['club-alpha-1',JSON.stringify({email:'private@example.test',home_venue:{name:'Ground',address:'Campus',private_code:'secret'},staff:[{name:'Coach',role:'coach',phone:'private'}]})]);
      const b=(await call('/api/v1/clubs/club-alpha-1')).body;assert.ok(!('email'in b));assert.ok(!('private_code'in b.home_venue));assert.ok(!('phone'in b.staff[0]));await reset();
    });
    await t.test('public GET routes remain rate limited while audit QR stays exempt',async()=>{
      await clearLimit();const responses=await Promise.all(Array.from({length:101},()=>fetch(base+'/api/v1/matches/match-m1/summary')));
      assert.equal(responses.filter(r=>r.status===200).length,100);const limited=responses.find(r=>r.status===429);assert.ok(Number(limited.headers.get('retry-after'))>=1);assert.equal((await limited.json()).error.code,'RATE_LIMITED');assert.equal((await call('/audit/v1/qr/match-m1?inspect=true')).status,200);await clearLimit();
    });
    await t.test('web paths serve the existing index and MinIO has a real health endpoint',async()=>{
      for(const path of ['/web/matches/match-m1/live','/web/costream/cs-session-101','/web/arbitrary/spa/path']){
        const r=await fetch(base+path);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/html/);assert.ok((await r.text()).length>20);
      }
      assert.equal((await fetch('http://minio:9000/minio/health/live')).status,200);
    });
    await t.test('hostile NUL and malformed Unicode are validation errors rather than server errors',async()=>{
      await clearLimit();
      for(const value of ['bad\u0000id','bad\uD800id'])bad(await call('/audit/v1/guest/cart-merge',cart({registered_user_id:value})),400,'VALIDATION_ERROR','registered_user_id');
      for(const [path,code]of [['/api/v1/matches/bad%00id','MATCH_NOT_FOUND'],['/api/v1/players/bad%00id','PLAYER_NOT_FOUND'],['/api/v1/clubs/bad%00id','CLUB_NOT_FOUND'],['/api/v1/costream/bad%00id','STREAM_NOT_FOUND']])bad(await call(path),404,code);
      const tokens=(await call('/audit/v1/rbac-matrix',{})).body.tokens;
      bad(await call('/api/v1/chat',{session_id:'cs-session-101',text:'bad\u0000text'},tokens.viewer),400,'VALIDATION_ERROR','text');
    });
    await t.test('reset clears chat, scan telemetry, issued guest tokens and merged carts',async()=>{
      await reset();assert.equal((await pool.query('SELECT * FROM chat_messages')).rowCount,0);assert.equal((await pool.query('SELECT * FROM chat_rooms')).rowCount,0);assert.equal((await pool.query('SELECT * FROM qr_scan_telemetry')).rowCount,0);assert.equal((await pool.query('SELECT * FROM guest_tokens')).rowCount,1);assert.deepEqual((await pool.query('SELECT data FROM user_carts')).rows[0].data,{items:[]});
    });
  }finally{await reset();await redis.quit();await pool.end();}
});
