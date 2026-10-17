import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createClient} from 'redis';
const teams=n=>Array.from({length:n},(_,i)=>`t${i+1}`);
const post=body=>fetch(((process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080') + '/audit/v1/fixtures'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('Section 5.7 live fixture API and absence of side effects',{skip:process.env.RUN_INTEGRATION!=='1'},async t=>{
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),redis=createClient({url:process.env.REDIS_URL});await redis.connect();
  const snapshot=async()=>{
    const state={};
    for(const table of ['sports','tenants','leagues','clubs','players','products','variants','discounts','users','app_state','matches','events','rosters','orders','order_outbox','offline_sync'])state[table]=(await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
    return state;
  };
  try {
    await redis.set('fixture-sentinel','unchanged');const before=await snapshot(),keys=(await redis.keys('*')).sort();
    await t.test('all formats and n=2..12 return 200 with exact format except double-elim minimum 3',async()=>{
      for(const format of ['round_robin','single_elim','swiss','double_elim'])for(let n=2;n<=12;n++){
        const response=await post({format,teams:teams(n)});
        if(format==='double_elim'&&n===2){assert.equal(response.status,400);continue;}
        assert.equal(response.status,200);assert.equal((await response.json()).format,format);
      }
    });
    await t.test('all format limits and malformed fields return standard validation errors',async()=>{
      const invalid=[null,[],{}, {format:'__proto__',teams:teams(4)}, {format:{toString:null},teams:teams(4)}, {format:'single_elim',teams:['same','same']}, {format:'single_elim',teams:['valid','bad|id']}, {format:'round_robin',teams:teams(4),params:null}, {format:'round_robin',teams:teams(4),params:{legs:{toString:null}}}, {format:'round_robin',teams:teams(4),params:{legs:null}}, {format:'round_robin',teams:teams(4),params:{withdrawals:null}}, {format:'round_robin',teams:teams(4),params:{withdrawal_policy:null}}, {format:'single_elim',teams:teams(4),params:{third_place_match:null}}];
      for(const [format,min,max]of [['round_robin',2,40],['single_elim',2,128],['swiss',2,64],['double_elim',3,128]]){invalid.push({format,teams:teams(min-1)},{format,teams:teams(max+1)});assert.equal((await post({format,teams:teams(max)})).status,200);}
      for(const body of invalid){const response=await post(body);assert.equal(response.status,400);const result=await response.json();assert.equal(result.error.code,'VALIDATION_ERROR');assert.ok(Array.isArray(result.error.details.fields)&&result.error.details.fields.length);assert.equal(typeof result.error.message,'string');}
    });
    await t.test('NO_VALID_PAIRING uses 409 and details.round',async()=>{
      const field=teams(6),history=Array.from({length:3},(_,r)=>({round:r+1,bye:null,matches:Array.from({length:3},(_,i)=>({home:field[i],away:field[3+(i+r)%3],result:'home'}))}));
      const response=await post({format:'swiss',teams:field,params:{round:4,total_rounds:5,history}});assert.equal(response.status,409);const body=await response.json();assert.equal(body.error.code,'NO_VALID_PAIRING');assert.deepEqual(body.error.details,{round:4});
    });
    await t.test('JSON errors and 1 MB body limit remain enforced',async()=>{
      const bad=await fetch(((process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080') + '/audit/v1/fixtures'),{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(bad.status,400);assert.equal((await bad.json()).error.code,'VALIDATION_ERROR');
      const large=await post({format:'round_robin',teams:teams(4),ignored:'x'.repeat(1048576)});assert.equal(large.status,413);assert.equal((await large.json()).error.code,'PAYLOAD_TOO_LARGE');
    });
    await t.test('fixtures preserve every PostgreSQL row and all Redis state',async()=>{
      assert.deepEqual(await snapshot(),before);assert.deepEqual((await redis.keys('*')).sort(),keys);assert.equal(await redis.get('fixture-sentinel'),'unchanged');
    });
  }finally{await redis.del('fixture-sentinel');await redis.quit();await pool.end();}
});
