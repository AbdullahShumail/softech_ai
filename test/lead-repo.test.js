import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, withinCallingHours } from '../src/data/lead-repo.js';

test('normalizePhone → E.164', () => {
  assert.equal(normalizePhone('(469) 555-0123'), '+14695550123');
  assert.equal(normalizePhone('14695550123'), '+14695550123');
  assert.equal(normalizePhone('+44 20 7946 0000'), '+442079460000');
  assert.equal(normalizePhone('555-01'), null);
  assert.equal(normalizePhone(''), null);
});

test('withinCallingHours respects the lead timezone', () => {
  // 2026-03-10 is DST in the US: 13:00 UTC → 09:00 New York (EDT), 06:00 Los Angeles (PDT)
  const t = new Date('2026-03-10T13:00:00Z');
  assert.equal(withinCallingHours('America/New_York', 8, 21, t), true);
  assert.equal(withinCallingHours('America/Los_Angeles', 8, 21, t), false); // 06:00, too early
});

test('withinCallingHours rejects an unknown timezone (fail closed)', () => {
  assert.equal(withinCallingHours('Mars/Olympus_Mons', 8, 21, new Date()), false);
});
