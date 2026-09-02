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

export function migrate() {
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
}

// Run migrations on import — schema is idempotent.
migrate();
