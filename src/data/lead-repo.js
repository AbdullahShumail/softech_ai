import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { db } from './db.js';

const _insertLead = db.prepare(
  `INSERT INTO leads (phone, company, timezone) VALUES (@phone, @company, @timezone)
   ON CONFLICT(phone) DO UPDATE SET
     company = COALESCE(excluded.company, leads.company),
     timezone = excluded.timezone`,
);
const _due = db.prepare(
  `SELECT * FROM leads
    WHERE status IN ('new', 'queued')
      AND do_not_call = 0
      AND phone NOT IN (SELECT phone FROM dnc)
      AND (last_attempt_at IS NULL OR last_attempt_at < datetime('now', @backoff))
    ORDER BY attempts ASC, id ASC
    LIMIT @limit`,
);
const _markDialing = db.prepare(
  `UPDATE leads SET status = 'dialing', attempts = attempts + 1, last_attempt_at = datetime('now')
    WHERE id = @id`,
);
const _setStatus = db.prepare(`UPDATE leads SET status = @status WHERE id = @id`);
const _counts = db.prepare(`SELECT status, COUNT(*) AS n FROM leads GROUP BY status`);

/** +E.164 best-effort. Assumes NANP when no country code is present. */
export function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.length >= 8 ? d : null;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return d.length >= 8 ? `+${d}` : null;
}

export function importLeadsCsv(path) {
  const rows = parse(readFileSync(path), { columns: true, skip_empty_lines: true, trim: true });
  const run = db.transaction((rs) => {
    let ok = 0;
    let skipped = 0;
    for (const r of rs) {
      const phone = normalizePhone(r.phone ?? r.number ?? r.Phone ?? r.Number);
      if (!phone) {
        skipped++;
        continue;
      }
      _insertLead.run({
        phone,
        company: r.company ?? r.Company ?? null,
        timezone: r.timezone ?? r.Timezone ?? 'America/New_York',
      });
      ok++;
    }
    return { ok, skipped };
  });
  return run(rows);
}

export function dueLeads(limit, backoffHours = 24) {
  return _due.all({ limit, backoff: `-${backoffHours} hours` });
}

export function markDialing(id) {
  _markDialing.run({ id });
}

export function setLeadStatus(id, status) {
  _setStatus.run({ id, status });
}

export function leadCounts() {
  return Object.fromEntries(_counts.all().map((r) => [r.status, r.n]));
}

/** True if `now` falls within [start,end) local time for the lead's timezone. */
export function withinCallingHours(timezone, start, end, now = new Date()) {
  let hour;
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(now),
    );
  } catch {
    return false; // unknown timezone → don't risk an off-hours call
  }
  if (hour === 24) hour = 0;
  return hour >= start && hour < end;
}
