import * as SQLite from 'expo-sqlite';
import { QueueItem } from '../types';

let connection: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  if (!connection) connection = (async () => {
    const database = await SQLite.openDatabaseAsync('skorly.db');
    await database.execAsync(`CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS queue (action_id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    return database;
  })();
  return connection;
}
export async function readCache<T>(key: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM cache WHERE key = ?', key);
  return row ? JSON.parse(row.value) as T : null;
}
export async function writeCache(key: string, value: unknown) {
  await (await db()).runAsync('INSERT OR REPLACE INTO cache (key, value) VALUES (?, ?)', key, JSON.stringify(value));
}
export async function writeCacheBatch(entries: [string, unknown][]) {
  const database = await db();
  await database.withTransactionAsync(async () => {
    for (const [key, value] of entries) await database.runAsync('INSERT OR REPLACE INTO cache (key, value) VALUES (?, ?)', key, JSON.stringify(value));
  });
}
export async function loadQueue(): Promise<QueueItem[]> {
  const rows = await (await db()).getAllAsync<{ value: string }>('SELECT value FROM queue ORDER BY rowid');
  return rows.map(row => JSON.parse(row.value) as QueueItem);
}
export async function insertAction(item: QueueItem) {
  await (await db()).runAsync('INSERT INTO queue (action_id, value) VALUES (?, ?)', item.action_id, JSON.stringify(item));
}
export async function removeAction(id: string) {
  await (await db()).runAsync('DELETE FROM queue WHERE action_id = ?', id);
}
