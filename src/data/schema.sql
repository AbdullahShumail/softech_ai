-- Phase 1 schema. All statements idempotent.

CREATE TABLE IF NOT EXISTS leads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  phone           TEXT NOT NULL UNIQUE,
  company         TEXT,
  timezone        TEXT DEFAULT 'America/New_York',
  status          TEXT NOT NULL DEFAULT 'new',   -- new | queued | dialing | done | failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  do_not_call     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

CREATE TABLE IF NOT EXISTS calls (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid          TEXT UNIQUE,
  lead_id           INTEGER REFERENCES leads(id),
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at          TEXT,
  answered          INTEGER NOT NULL DEFAULT 0,
  final_disposition TEXT,
  pitch_delivered   INTEGER NOT NULL DEFAULT 0,
  transferred       INTEGER NOT NULL DEFAULT 0,
  duration_s        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_calls_lead ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_disposition ON calls(final_disposition);

CREATE TABLE IF NOT EXISTS call_turns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id      INTEGER NOT NULL REFERENCES calls(id),
  turn         INTEGER NOT NULL,
  transcript   TEXT,
  disposition  TEXT,
  thought      TEXT,
  latency_ms   INTEGER,
  ts           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_turns_call ON call_turns(call_id);

CREATE TABLE IF NOT EXISTS dnc (
  phone     TEXT PRIMARY KEY,
  added_at  TEXT NOT NULL DEFAULT (datetime('now')),
  source    TEXT
);

CREATE TABLE IF NOT EXISTS runner_state (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
