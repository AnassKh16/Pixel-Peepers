import cluster from 'node:cluster';
import {availableParallelism} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createTokenService} from './auth.js';
import {createDLQ} from './dlq.js';
import {initPrivacy} from './privacy.js';
import pg from 'pg';
import {requireDay2Salt} from './day2-signature.js';
requireDay2Salt();
import { createClient } from 'redis';
import { createSigner } from './signature.js';
import { schema, resetDatabase } from './database.js';
import { createApp } from './app.js';
import { startOrderPublisher } from './order-events.js';

// Read once at startup; preserve the exact UTF-8 value, including whitespace.
export const sign = createSigner(process.env.DAY1_SALT);
const workers=Math.min(4,availableParallelism());
if(cluster.isPrimary&&workers>1){
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
  const redis=createClient({url:process.env.REDIS_URL});redis.on('error',error=>console.error('Redis:',error.message));
  await redis.connect();await pool.query(schema);await resetDatabase(pool,redis,{},sign);
  await createDLQ(pool).init();await initPrivacy(pool);
  const demoHash=(await pool.query('SELECT password_hash FROM users LIMIT 1')).rows[0].password_hash;
  await redis.quit();await pool.end();
  const jwtSecret=randomBytes(32).toString('base64');
  let closing=false,nextMetric=0;const pending=new Map();
  const fork=publisher=>{
    const worker=cluster.fork({BACKEND_JWT_SECRET:jwtSecret,PUBLISH_ORDERS:publisher?'1':'0',DEMO_PASSWORD_HASH:demoHash});
    worker.publisher=publisher;
    worker.on('message',message=>{
      if(message.type==='ready'){worker.ready=true;return;}
      if(message.type==='ws-total'){
        const requestId=++nextMetric,peers=Object.values(cluster.workers).filter(w=>w.isConnected()&&w.ready);
        const entry={worker,original:message.requestId,waiting:new Set(peers.map(w=>w.id)),count:0};pending.set(requestId,entry);
        for(const peer of peers)peer.send({type:'ws-count',requestId});
      }else if(message.type==='ws-count'){
        const entry=pending.get(message.requestId);if(!entry||!entry.waiting.delete(worker.id))return;
        entry.count+=message.count;if(!entry.waiting.size){pending.delete(message.requestId);if(entry.worker.isConnected())entry.worker.send({type:'ws-total-result',requestId:entry.original,count:entry.count});}
      }
    });
    return worker;
  };
  for(let i=0;i<workers;i++)fork(i===0);
  cluster.on('exit',worker=>{if(!closing)fork(worker.publisher);});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{closing=true;for(const worker of Object.values(cluster.workers))worker.process.kill('SIGTERM');});
}else{
  process.env.BACKEND_JWT_SECRET??=randomBytes(32).toString('base64');
  let metricRequest=0;const metricPending=new Map();
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000, query_timeout: 8000, max: 8});
const redis = createClient({url: process.env.REDIS_URL, socket: {connectTimeout: 2000}});
redis.on('error', error => console.error('Redis:', error.message));
let server;
let stopOrderPublisher;
try {
  await redis.connect();
  if(!cluster.isWorker){await pool.query(schema);await resetDatabase(pool,redis);}
  await createDLQ(pool).init();await initPrivacy(pool);
  if(!cluster.isWorker||process.env.PUBLISH_ORDERS==='1')stopOrderPublisher=startOrderPublisher(pool,redis);
  const tokens=createTokenService(Buffer.from(process.env.BACKEND_JWT_SECRET,'base64'));
  const app=createApp(pool,redis,tokens,sign);
  await app.locals.b3.dlq.init();
  const connections=await Promise.all(Array.from({length:8},()=>pool.connect()));
  connections.forEach(client=>client.release());
  if(cluster.isWorker)app.locals.getActiveWsConnections=()=>new Promise(resolve=>{
    const requestId=++metricRequest;metricPending.set(requestId,resolve);process.send({type:'ws-total',requestId});
  });
  process.on('message',message=>{
    if(message.type==='ws-count')process.send({type:'ws-count',requestId:message.requestId,count:app.locals.activeWsConnections});
    if(message.type==='ws-total-result'){metricPending.get(message.requestId)?.(message.count);metricPending.delete(message.requestId);}
  });
  if(cluster.isWorker)process.send({type:'ready'});
  server = app.listen(8080, '0.0.0.0', () => console.log('Listening on 0.0.0.0:8080'));
  app.locals.scoreStreams.attach(server);
  server.scoreStreams=app.locals.scoreStreams;
} catch (error) {
  console.error('Startup failed:', error.message);
  process.exit(1);
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
  stopOrderPublisher?.();
  server.scoreStreams.close().finally(()=>server.close(async () => { await redis.quit(); await pool.end(); process.exit(0); }));
});

}
