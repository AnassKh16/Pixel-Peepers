// Deduplicate stream delivery atomically, including retry after a DB acknowledgement fails.
const publishScript = `
local previous = redis.call('GET', KEYS[2])
if previous then return previous end
local id = redis.call('XADD', KEYS[1], '*', 'event_id', ARGV[1], 'type', 'order.status_changed', 'order_id', ARGV[2], 'status', 'paid', 'payload', ARGV[3])
redis.call('SET', KEYS[2], id)
return id
`;

export async function publishOrderEvents(pool, redis) {
  if (!redis.isReady) throw new Error('Redis is not ready for order events');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows} = await client.query('SELECT order_id, payload FROM order_outbox WHERE NOT published ORDER BY order_id LIMIT 100 FOR UPDATE SKIP LOCKED');
    for (const row of rows) {
      await redis.eval(publishScript, {
        keys: ['order-status', `order-status-published:${row.order_id}`],
        arguments: [`order:${row.order_id}:paid`, row.order_id, JSON.stringify(row.payload)]
      });
      await client.query('UPDATE order_outbox SET published=true WHERE order_id=$1', [row.order_id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export function startOrderPublisher(pool, redis) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await publishOrderEvents(pool, redis); }
    catch (error) { console.error('Order event delivery pending:', error.message); }
    finally { running = false; }
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
