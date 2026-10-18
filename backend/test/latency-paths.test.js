import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import pg from 'pg';
import {WebSocket} from 'ws';
import {resolveQr} from '../src/qr.js';
import {createDLQ} from '../src/dlq.js';
import {signDay2} from '../src/day2-signature.js';

// The query double forbids reserving a client, transaction control, and writes.
test('QR inspection uses one read statement and never connects or writes, even for unmapped entities',async()=>{
  let queries=0;
  const pool={connect(){assert.fail('inspection reserved a client');},async query(sql,args){
    queries++;assert.match(sql,/^WITH entity AS/);assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|BEGIN|COMMIT)\b/);
    assert.deepEqual(args,['player-custom']);return {rows:[{kind:'player',data:{},records:[],mapping:null}]};
  }};
  const a=await resolveQr(pool,'player-custom',{inspect:true}),b=await resolveQr(pool,'player-custom',{inspect:true});
  assert.deepEqual(a,b);assert.equal(queries,2);assert.equal(a.scan_count,0);
  assert.equal(a.signature,signDay2('player-custom',{entity_id:a.entity_id,short_url:a.short_url,target_route:a.target_route}));
});

test('simultaneous inspections batch before SQL starts, while later reads see fresh state',async()=>{
  let queries=0,status='upcoming';
  const pool={async query(){queries++;return {rows:[{kind:'match',data:{status},records:[],mapping:{short_url:'http://localhost:8080/q/test',scan_count:0}}]};}};
  const results=await Promise.all(Array.from({length:50},()=>resolveQr(pool,'match-test',{inspect:true})));
  assert.equal(queries,1);assert.ok(results.every(q=>q.entity_status==='upcoming'));
  status='completed';assert.equal((await resolveQr(pool,'match-test',{inspect:true})).entity_status,'completed');assert.equal(queries,2);
});

test('read-path and multi-worker regression checks against running services',{skip:process.env.RUN_INTEGRATION!=='1',timeout:60000},async t=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const base='http://127.0.0.1:8080';
  const call=async(path,body,token)=>{
    const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Connection:'close',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};
  };
  const reset=()=>call('/audit/v1/reset',{});
  try{
    await reset();
    await t.test('inspect succeeds inside a PostgreSQL READ ONLY transaction and does not create a missing mapping',async()=>{
      const client=await pool.connect();let inspected;
      try{
        await client.query('BEGIN READ ONLY');
        const before=(await client.query('SELECT count(*) AS n FROM qr_mappings')).rows[0].n;
        inspected=await resolveQr(client,'demo-player-alpha-02',{inspect:true});
        assert.equal((await client.query('SELECT count(*) AS n FROM qr_mappings')).rows[0].n,before);
        assert.equal((await client.query('SELECT 1 FROM qr_mappings WHERE entity_id=$1',['demo-player-alpha-02'])).rowCount,0);
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      const redirect=await fetch(inspected.short_url,{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),inspected.target_route);
      const scanned=await call('/audit/v1/qr/demo-player-alpha-02?inspect=true');assert.equal(scanned.status,200);assert.equal(scanned.body.short_url,inspected.short_url);assert.equal(scanned.body.scan_count,1);
    });
    await t.test('DLQ snapshot reads do not wait for the exclusive writer advisory lock',async()=>{
      const dlq=createDLQ(pool);await dlq.init();const writer=await pool.connect();let timer;
      try{
        await writer.query('BEGIN');await writer.query('SELECT pg_advisory_xact_lock(5506)');
        const result=await Promise.race([dlq.snapshot(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('read waited for writer lock')),1000);})]);
        assert.deepEqual(result,{queue_depth:0,undelivered_events:[]});
      }finally{clearTimeout(timer);await writer.query('ROLLBACK');writer.release();}
    });
    await t.test('all workers accept the same runtime-issued member JWT',async()=>{
      const token=(await call('/audit/v1/rbac-matrix',{})).body.tokens.viewer;
      const responses=await Promise.all(Array.from({length:24},()=>call('/api/v1/me',undefined,token)));
      for(const r of responses){assert.equal(r.status,200);assert.equal(r.body.role,'viewer');}
    });
    await t.test('resets from different workers retain identical baseline password hashes and QR data',async()=>{
      let original;
      for(let i=0;i<5;i++){
        assert.equal((await reset()).status,200);
        const state={users:(await pool.query('SELECT user_id,password_hash FROM users ORDER BY user_id')).rows,qr:(await pool.query('SELECT entity_id,data FROM qr_mappings ORDER BY entity_id')).rows};
        if(original)assert.deepEqual(state,original);else original=state;
      }
    });
    await t.test('metrics scraped on any worker count all real score subscribers',async()=>{
      const sockets=Array.from({length:4},()=>new WebSocket(base.replace('http','ws')+'/ws/matches/match-m1'));
      try{
        await Promise.all(sockets.map(async ws=>{const initial=once(ws,'message');await once(ws,'open');await initial;}));
        for(let i=0;i<8;i++){const r=await fetch(base+'/metrics',{headers:{Connection:'close'}});assert.equal(r.status,200);assert.match(await r.text(),/^nascon_active_ws_connections 4$/m);}
      }finally{await Promise.all(sockets.map(async ws=>{const closed=once(ws,'close');ws.close();await closed;}));}
    });
  }finally{await reset();await pool.end();}
});
