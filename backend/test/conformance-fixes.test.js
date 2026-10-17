import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:8080';
const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body});
const checkPayload=async(raw,id)=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  try {
    const before=(await pool.query('SELECT count(*)::int AS n FROM events')).rows[0].n;
    // Missing match would be 404 for valid input; malformed payload must win first.
    const event=`{"event_id":"${id}","match_id":"missing-conformance-match","type":"match_start","payload":{"extra":${raw}}}`;
    const r=await post('/audit/v1/events',event);assert.equal(r.status,400);const body=await r.json();assert.equal(body.error.code,'VALIDATION_ERROR');assert.ok(body.error.details.fields.includes('payload'));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM events')).rows[0].n,before);
    const queue=`{"device_id":"conformance-device","actions":[{"action_id":"${id}","type":"score_event","queued_at":"2026-10-17T11:00:00Z","base_version":0,"payload":${event}}]}`;
    const sync=await post('/audit/v1/offline-sync',queue);assert.equal(sync.status,200);const first=await sync.json();assert.deepEqual(first.summary,{applied:0,rejected:1,duplicate:0});assert.equal(first.results[0].error_code,'VALIDATION_ERROR');assert.equal(first.results[0].resolution,'server_wins');
    const replay=await post('/audit/v1/offline-sync',queue);assert.equal(replay.status,200);assert.deepEqual((await replay.json()).summary,{applied:0,rejected:0,duplicate:1});
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM events')).rows[0].n,before);
  }finally{await pool.end();}
};
test('conformance: non-finite signed payload returns validation error before missing references, including offline sync',{skip:process.env.RUN_INTEGRATION!=='1'},async()=>checkPayload('1e999','conformance-non-finite'));
test('conformance: deeply nested signed payload never causes 5xx or breaks rejected-action replay',{skip:process.env.RUN_INTEGRATION!=='1'},async()=>checkPayload('['.repeat(6000)+'0'+']'.repeat(6000),'conformance-deep'));
