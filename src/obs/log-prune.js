import { readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';

/** Delete per-call JSON logs older than maxAgeDays. Returns count removed. */
export function pruneCallLogs(dir, maxAgeDays = 30) {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let removed = 0;
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const p = join(dir, f);
    try {
      if (statSync(p).mtimeMs < cutoff) {
        rmSync(p);
        removed++;
      }
    } catch {
      /* ignore */
    }
  }
  if (removed) logger.info({ dir, removed, maxAgeDays }, 'pruned old call logs');
  return removed;
}

/** Prune now, then every `everyMs` (default daily). Timer is unref'd. */
export function scheduleCallLogPrune(dir, maxAgeDays = 30, everyMs = 86_400_000) {
  pruneCallLogs(dir, maxAgeDays);
  const t = setInterval(() => pruneCallLogs(dir, maxAgeDays), everyMs);
  t.unref?.();
  return t;
}
