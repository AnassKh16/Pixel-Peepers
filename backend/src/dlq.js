import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const schema = `
CREATE TABLE IF NOT EXISTS day2_dlq (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text UNIQUE NOT NULL,
  data jsonb NOT NULL
);
CREATE OR REPLACE FUNCTION day2_clear_dlq_on_reset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM day2_dlq;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS day2_dlq_reset ON app_state;
CREATE TRIGGER day2_dlq_reset AFTER TRUNCATE ON app_state
FOR EACH STATEMENT EXECUTE FUNCTION day2_clear_dlq_on_reset();
`;

/**
 * Persistent queue using the existing pg Pool; no process-local queue/counter.
 * resetDatabase already truncates app_state under exclusive advisory lock 5505.
 * Its transactional trigger clears this queue even when another app instance resets.
 */
export function createDLQ(pool, {deliver = async () => { throw new Error('Simulated delivery failure'); }, sleep = delay} = {}) {
  let initializing;
  async function transaction(action) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // One lock order everywhere: reset barrier, then queue lock. No lock upgrades.
      await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
      await client.query('SELECT pg_advisory_xact_lock(5506)');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async function init() {
    if (!initializing) initializing = transaction(client => client.query(schema)).catch(error => {
      initializing = undefined; throw error;
    });
    await initializing;
  }
  async function read(client) {
    const {rows} = await client.query('SELECT data FROM day2_dlq ORDER BY sequence');
    return {queue_depth: rows.length, undelivered_events: rows.map(row => row.data)};
  }
  async function enqueue(count) {
    if (!Number.isSafeInteger(count) || count < 0) throw new TypeError('Failed notification count must be a non-negative safe integer');
    await init();
    // Retry outside the DB transaction: a slow receiver never holds database locks.
    const failed = [];
    for (let index = 0; index < count; index++) {
      const event_id = randomUUID();
      for (let attempts = 1; attempts <= 3; attempts++) {
        try { await deliver({event_id, type: 'notification_delivery_failed'}, attempts); break; }
        catch {
          if (attempts < 3) await sleep(2 ** (attempts - 1));
          else failed.push({event_id, type: 'notification_delivery_failed', attempts: 3,
            last_error: 'Delivery failed after 3 attempts', created_at: new Date().toISOString()});
        }
      }
    }
    return transaction(async client => {
      if (failed.length) await client.query(
        'INSERT INTO day2_dlq(event_id,data) SELECT item->>\'event_id\', item FROM jsonb_array_elements($1::jsonb) AS item',
        [JSON.stringify(failed)]);
      return read(client);
    });
  }
  async function snapshot() { await init(); return read(pool); }
  async function depth() {
    await init();
    return Number((await pool.query('SELECT count(*) AS count FROM day2_dlq')).rows[0].count);
  }
  async function undelivered() { return (await snapshot()).undelivered_events; }
  async function clear() { await init(); return transaction(client => client.query('DELETE FROM day2_dlq')); }
  return {init, enqueue, snapshot, depth, undelivered, clear};
}
