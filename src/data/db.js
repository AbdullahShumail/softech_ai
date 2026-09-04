import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));

mkdirSync(dirname(config.db.path), { recursive: true });

export const db = new Database(config.db.path);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * CREATE TABLE IF NOT EXISTS cannot add a column to a table that already exists,
 * so columns added after a database is in the field need an explicit, guarded
 * ALTER. Checking PRAGMA table_info keeps it idempotent.
 */
function addColumn(table, column, decl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

export function migrate() {
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  addColumn('call_turns', 'route', 'TEXT');
  addColumn('call_turns', 'prompts', 'TEXT');
}

// Run migrations on import — schema is idempotent.
migrate();
