import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pruneCallLogs } from '../src/obs/log-prune.js';

test('pruneCallLogs removes only .json files older than the cutoff', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prune-'));
  const old = join(dir, 'old.json');
  const fresh = join(dir, 'fresh.json');
  const other = join(dir, 'notes.txt');

  for (const p of [old, fresh, other]) writeFileSync(p, '{}');
  const longAgo = Date.now() / 1000 - 60 * 86400; // 60 days
  utimesSync(old, longAgo, longAgo);
  utimesSync(other, longAgo, longAgo);

  const removed = pruneCallLogs(dir, 30);
  assert.equal(removed, 1);
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
  assert.equal(existsSync(other), true); // not a .json — left alone
});

test('pruneCallLogs on a missing dir is a no-op', () => {
  assert.equal(pruneCallLogs(join(tmpdir(), 'does-not-exist-xyz'), 30), 0);
});
