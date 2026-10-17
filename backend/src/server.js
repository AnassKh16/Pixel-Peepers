import pg from 'pg';
import { createClient } from 'redis';
import { createSigner } from './signature.js';
import { schema, resetDatabase } from './database.js';
import { createApp } from './app.js';
import { startOrderPublisher } from './order-events.js';

// Read once at startup; preserve the exact UTF-8 value, including whitespace.
export const sign = createSigner(process.env.DAY1_SALT);
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000, query_timeout: 8000, max: 10});
const redis = createClient({url: process.env.REDIS_URL, socket: {connectTimeout: 2000}});
redis.on('error', error => console.error('Redis:', error.message));
let server;
let stopOrderPublisher;
try {
  await redis.connect();
  await pool.query(schema);
  await resetDatabase(pool, redis);
  stopOrderPublisher = startOrderPublisher(pool, redis);
  server = createApp(pool, redis, undefined, sign).listen(8080, '0.0.0.0', () => console.log('Listening on 0.0.0.0:8080'));
} catch (error) {
  console.error('Startup failed:', error.message);
  process.exit(1);
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
  stopOrderPublisher();
  server.close(async () => { await redis.quit(); await pool.end(); process.exit(0); });
});
