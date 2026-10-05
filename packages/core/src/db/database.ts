import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations';

export type Db = Database.Database;

/**
 * Opens (or creates) the SQLite database and applies pending migrations.
 * Pass ':memory:' for tests.
 */
export function openDatabase(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: Db): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  const current = row.v ?? 0;
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  const apply = db.transaction(() => {
    for (const m of pending) {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        m.version,
        Date.now(),
      );
    }
  });
  apply();
  return pending.length;
}
