import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import pg from 'pg';
import { createClient } from 'redis';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { publishOrderEvents } from '../src/order-events.js';

const M = 'var-jersey-001-M';
const L = 'var-jersey-001-L';
const base = ((process.env.TEST_BASE_URL ?? 'http://127.0.0.1:8080') + '');
const order = (order_id, changes = {}) => ({order_id, customer_id: 'cust-001', items: [{variant_id: M, quantity: 1}], discount_code: null, payment: {token: 'tok_success'}, ...changes});
const post = (path, body) => fetch(base + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
const stock = async (variant = M) => {
  const response = await fetch(`${base}/audit/v1/inventory/${encodeURIComponent(variant)}`);
  assert.equal(response.status, 200);
  return response.json();
};
async function expectError(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.ok(body.error.details && !Array.isArray(body.error.details));
  return body.error.details;
}
// Independent canonicalization for the receipt verification, rather than calling production signing code.
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
async function checkReceipt(response, request, total = 450000) {
  assert.deepEqual(Object.keys(response).sort(), ['order_id','status','currency','items','subtotal_minor','discount_minor','total_minor','payment','receipt'].sort());
  assert.equal(response.order_id, request.order_id);
  assert.equal(response.status, 'paid');
  assert.equal(response.currency, 'PKR');
  assert.equal(response.total_minor, total);
  assert.equal(response.subtotal_minor - response.discount_minor, total);
  assert.equal(response.payment.state, 'captured');
  assert.equal(typeof response.payment.authorization_id, 'string');
  assert.equal(typeof response.payment.capture_id, 'string');
  const payload = response.receipt.payload;
  assert.deepEqual(Object.keys(payload).sort(), ['order_id','customer_id','items','subtotal_minor','discount_minor','total_minor','currency','paid_at'].sort());
  for (const key of ['order_id','items','subtotal_minor','discount_minor','total_minor','currency']) assert.deepEqual(payload[key], response[key]);
  assert.equal(payload.customer_id, request.customer_id);
  assert.match(payload.paid_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  const signature = createHmac('sha256', Buffer.from(process.env.DAY1_SALT, 'utf8')).update(`${request.order_id}|${canonical(payload)}`, 'utf8').digest('hex');
  assert.equal(response.receipt.signature, signature);
  const pdf = Buffer.from(response.receipt.pdf_base64, 'base64');
  assert.equal(pdf.subarray(0,4).toString(), '%PDF');
  const loading = getDocument({data: new Uint8Array(pdf), useSystemFonts: true, isEvalSupported: false});
  const document = await loading.promise;
  try {
    const text = (await (await document.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
    assert.ok(text.includes(request.order_id), text);
    assert.ok(text.includes(`PKR ${(total / 100).toFixed(2)}`), text);
  } finally { await document.destroy(); }
}

// Twenty real OS-backed worker threads wait at one shared barrier before sending HTTP requests.
async function threadedBurst(requests) {
  const shared = new SharedArrayBuffer(4);
  const barrier = new Int32Array(shared);
  const workers = requests.map(request => {
    let readyResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const worker = new Worker(`
      const {parentPort, workerData} = require('node:worker_threads');
      const barrier = new Int32Array(workerData.shared);
      parentPort.postMessage({ready:true});
      Atomics.wait(barrier, 0, 0);
      (async () => {
        const response = await fetch(workerData.url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(workerData.request)});
        parentPort.postMessage({result:{status:response.status,body:await response.json()}});
      })().catch(error => { throw error; });
    `, {eval: true, workerData: {shared, request, url: `${base}/audit/v1/checkout`}});
    const result = new Promise((resolve, reject) => {
      worker.on('message', message => { if (message.ready) readyResolve(); else if (message.result) resolve(message.result); });
      worker.once('error', error => { readyResolve(); reject(error); });
      worker.once('exit', code => { if (code !== 0) reject(new Error(`Buyer thread exited ${code}`)); });
    });
    return {worker, ready, result};
  });
  try {
    await Promise.all(workers.map(entry => entry.ready));
    const started = Date.now();
    Atomics.store(barrier, 0, 1);
    Atomics.notify(barrier, 0, requests.length);
    const results = await Promise.all(workers.map(entry => entry.result));
    return {results, elapsed: Date.now() - started};
  } finally { await Promise.all(workers.map(entry => entry.worker.terminate())); }
}

test('Section 5.12 checkout and inventory against running stack', {skip: process.env.RUN_INTEGRATION !== '1', timeout: 120000}, async t => {
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
  const redis = createClient({url: process.env.REDIS_URL});
  await redis.connect();
  const reset = async (body = {}) => assert.equal((await post('/audit/v1/reset', body)).status, 200);
  try {
    await reset();
    await t.test('inventory has exact defaults; missing and hostile ids return VARIANT_NOT_FOUND', async () => {
      assert.deepEqual(await stock(), {variant_id:M,stock:1,reserved:0});
      assert.deepEqual(await stock(L), {variant_id:L,stock:5,reserved:0});
      for (const variant of ['missing', "x'; DROP TABLE variants;--", '<script>']) {
        await expectError(await fetch(`${base}/audit/v1/inventory/${encodeURIComponent(variant)}`),404,'VARIANT_NOT_FOUND');
      }
    });
    await t.test('schema errors return VALIDATION_ERROR before reference, discount or inventory checks', async () => {
      const invalid = [null, [], {}, order(''), order('bad|id'), order('v',{customer_id:1}), order('v',{items:[]}), order('v',{items:Array(11).fill({variant_id:M,quantity:1})}), order('v',{items:[null]}), order('v',{items:[{variant_id:M,quantity:0}]}), order('v',{items:[{variant_id:M,quantity:1.5}]}), order('v',{items:[{variant_id:M,quantity:11}]}), order('v',{items:[{variant_id:M,quantity:'1'}]}), order('v',{items:[{variant_id:M,quantity:1},{variant_id:M,quantity:1}]}), order('v',{payment:null}), order('v',{payment:{token:'invalid'}}), order('v',{discount_code:2}), order('v',{items:[{variant_id:'missing',quantity:0}],discount_code:'invalid'})];
      for (const body of invalid) {
        const details = await expectError(await post('/audit/v1/checkout',body),400,'VALIDATION_ERROR');
        assert.ok(Array.isArray(details.fields) && details.fields.length > 0);
      }
      const malformed = await fetch(base+'/audit/v1/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
      await expectError(malformed,400,'VALIDATION_ERROR');
      await expectError(await post('/audit/v1/checkout',order('huge',{ignored:'x'.repeat(1048576)})),413,'PAYLOAD_TOO_LARGE');
      assert.deepEqual(await stock(), {variant_id:M,stock:1,reserved:0});
    });
    await t.test('reference validation precedes discount validation; no stock changes', async () => {
      const details = await expectError(await post('/audit/v1/checkout',order('missing',{items:[{variant_id:'missing',quantity:1}],discount_code:'invalid'})),404,'VARIANT_NOT_FOUND');
      assert.equal(details.variant_id,'missing');
      await expectError(await post('/audit/v1/checkout',order('discount',{discount_code:'invalid'})),400,'INVALID_DISCOUNT_CODE');
      assert.deepEqual(await stock(), {variant_id:M,stock:1,reserved:0});
    });
    await t.test('paid response, signature, independent PDF text extraction, and Redis order-status event', async () => {
      const request = order('ord-receipt',{customer_id:"cust'<script>"});
      const response = await post('/audit/v1/checkout',request);
      assert.equal(response.status,201);
      const body = await response.json();
      assert.deepEqual(body.items,[{variant_id:M,quantity:1,unit_price_minor:450000}]);
      await checkReceipt(body,request);
      assert.deepEqual(await stock(),{variant_id:M,stock:0,reserved:0});
      const entries = await redis.xRange('order-status','-','+');
      assert.equal(entries.length,1);
      assert.equal(entries[0].message.type,'order.status_changed');
      assert.equal(entries[0].message.order_id,request.order_id);
      assert.equal(entries[0].message.status,'paid');
      assert.equal(JSON.parse(entries[0].message.payload).order_id,request.order_id);
      assert.equal((await pool.query('SELECT published FROM order_outbox WHERE order_id=$1',[request.order_id])).rows[0].published,true);
      await pool.query('UPDATE order_outbox SET published=false WHERE order_id=$1',[request.order_id]);
      await publishOrderEvents(pool,redis);
      assert.equal(await redis.xLen('order-status'),1,'outbox retry must not duplicate events');
    });
    await t.test('identical replay returns exact stored receipt and ignores unknown fields; changed bodies conflict', async () => {
      const request = order('ord-receipt',{customer_id:"cust'<script>"});
      const before = (await pool.query('SELECT data FROM orders WHERE order_id=$1',[request.order_id])).rows[0].data.response;
      const replay = await post('/audit/v1/checkout',{...request,ignored:'new',payment:{token:'tok_success',ignored:true}});
      assert.equal(replay.status,200);
      assert.deepEqual(await replay.json(),before);
      for (const changed of [{customer_id:'different'},{items:[{variant_id:M,quantity:2}]},{payment:{token:'tok_declined'}}]) {
        await expectError(await post('/audit/v1/checkout',{...request,...changed}),409,'DUPLICATE_ORDER_ID');
      }
      assert.deepEqual(await stock(),{variant_id:M,stock:0,reserved:0});
      assert.equal(await redis.xLen('order-status'),1);
    });
    for (const [token,code] of [['tok_declined','PAYMENT_DECLINED'],['tok_capture_fail','PAYMENT_CAPTURE_FAILED']]) {
      await t.test(`${code}: all reservations released and same order id can be retried`, async () => {
        await reset();
        const request = order(`ord-${token}`,{items:[{variant_id:M,quantity:1},{variant_id:L,quantity:2}],payment:{token}});
        await expectError(await post('/audit/v1/checkout',request),402,code);
        assert.deepEqual(await stock(),{variant_id:M,stock:1,reserved:0});
        assert.deepEqual(await stock(L),{variant_id:L,stock:5,reserved:0});
        assert.equal((await pool.query('SELECT * FROM orders')).rowCount,0);
        assert.equal((await pool.query('SELECT * FROM order_outbox')).rowCount,0);
        assert.equal(await redis.xLen('order-status'),0);
        assert.equal((await post('/audit/v1/checkout',{...request,payment:{token:'tok_success'}})).status,201);
        assert.deepEqual(await stock(L),{variant_id:L,stock:3,reserved:0});
      });
    }
    await t.test('WELCOME10 uses floor rounding and multi-item totals and PDF remain consistent', async () => {
      await reset();
      await pool.query('UPDATE variants SET price_minor=$2 WHERE variant_id=$1',[M,450001]);
      const request = order('ord-discount',{discount_code:'WELCOME10',items:[{variant_id:L,quantity:2},{variant_id:M,quantity:1}]});
      const response = await post('/audit/v1/checkout',request);
      assert.equal(response.status,201);
      const body = await response.json();
      assert.equal(body.subtotal_minor,1350001);
      assert.equal(body.discount_minor,135000);
      await checkReceipt(body,request,1215001);
    });
    await t.test('multi-item shortage reserves nothing and reports OUT_OF_STOCK with variant id', async () => {
      await reset({stock:{[L]:0}});
      const details = await expectError(await post('/audit/v1/checkout',order('ord-shortage',{items:[{variant_id:M,quantity:1},{variant_id:L,quantity:1}]})),409,'OUT_OF_STOCK');
      assert.equal(details.variant_id,L);
      assert.deepEqual(await stock(),{variant_id:M,stock:1,reserved:0});
      assert.deepEqual(await stock(L),{variant_id:L,stock:0,reserved:0});
    });
    await t.test('20-thread last-unit burst: exactly one 201, nineteen 409, stock 0, reserved 0', async () => {
      await reset();
      const {results,elapsed} = await threadedBurst(Array.from({length:20},(_,index) => order(`burst-${index}`)));
      assert.equal(results.filter(result => result.status === 201).length,1);
      assert.equal(results.filter(result => result.status === 409 && result.body.error.code === 'OUT_OF_STOCK').length,19);
      assert.ok(elapsed < 10000, `burst took ${elapsed} ms`);
      t.diagnostic(`20 threads: 1 created, 19 OUT_OF_STOCK; ${elapsed} ms`);
      assert.deepEqual(await stock(),{variant_id:M,stock:0,reserved:0});
      assert.equal((await pool.query('SELECT * FROM orders')).rowCount,1);
      assert.equal(await redis.xLen('order-status'),1);
      assert.equal((await pool.query('SELECT * FROM variants WHERE stock<0 OR reserved<>0')).rowCount,0);
    });
    await t.test('20-thread identical-order replay: one 201, nineteen 200, one receipt and event', async () => {
      await reset();
      const {results,elapsed} = await threadedBurst(Array.from({length:20},() => order('concurrent-replay')));
      assert.equal(results.filter(result => result.status===201).length,1);
      assert.equal(results.filter(result => result.status===200).length,19);
      for (const result of results) assert.deepEqual(result.body,results[0].body);
      assert.ok(elapsed<10000);
      assert.deepEqual(await stock(),{variant_id:M,stock:0,reserved:0});
      assert.equal(await redis.xLen('order-status'),1);
    });
    await t.test('opposite basket order avoids deadlocks and cannot partially consume stock', async () => {
      await reset({stock:{[M]:1,[L]:1}});
      const items = [{variant_id:M,quantity:1},{variant_id:L,quantity:1}];
      const {results} = await threadedBurst([order('opposite-1',{items}),order('opposite-2',{items:[...items].reverse()})]);
      assert.deepEqual(results.map(result => result.status).sort(),[201,409]);
      assert.deepEqual(await stock(),{variant_id:M,stock:0,reserved:0});
      assert.deepEqual(await stock(L),{variant_id:L,stock:0,reserved:0});
    });
    await t.test('reset clears orders, reservations, outbox, and Redis stream', async () => {
      await reset();
      assert.equal((await pool.query('SELECT * FROM orders')).rowCount,0);
      assert.equal((await pool.query('SELECT * FROM order_outbox')).rowCount,0);
      assert.equal(await redis.xLen('order-status'),0);
      assert.deepEqual(await stock(),{variant_id:M,stock:1,reserved:0});
    });
  } finally { await reset(); await redis.quit(); await pool.end(); }
});
