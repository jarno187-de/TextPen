import { DatabaseSync } from 'node:sqlite';

// Local stand-in for a Durable Object's storage.sql (tests and dev server only), plus the same
// throttle as ControlStore.consumeLimit in control/src/store.js.
export function memorySql(file = ':memory:') {
  const db = new DatabaseSync(file);
  const sql = {
    exec(query, ...params) {
      if (!params.length && query.trim().split(';').filter(s => s.trim()).length > 1) { db.exec(query); return { toArray: () => [] }; }
      const rows = /^\s*(SELECT|WITH)/i.test(query) ? db.prepare(query).all(...params) : (db.prepare(query).run(...params), []);
      return { toArray: () => rows.map(r => ({ ...r })) };
    }
  };
  sql.exec('CREATE TABLE IF NOT EXISTS throttle (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at INTEGER NOT NULL)');
  const limit = (key, max, windowMs) => {
    const now = Date.now(), row = sql.exec('SELECT count,until_at FROM throttle WHERE key=?', key).toArray()[0];
    if (!row || row.until_at <= now) { sql.exec('INSERT INTO throttle(key,count,until_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=1,until_at=excluded.until_at', key, now + windowMs); return true; }
    if (row.count >= max) return false;
    sql.exec('UPDATE throttle SET count=count+1 WHERE key=?', key); return true;
  };
  return { sql, limit };
}
