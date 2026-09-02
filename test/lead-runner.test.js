import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/data/db.js';
import { LeadRunner } from '../src/runner/lead-runner.js';
import { lookupCall } from '../src/runner/registry.js';

function seedLead(phone, tz = 'America/New_York') {
  db.prepare(
    `INSERT INTO leads (phone, company, timezone, status) VALUES (?, 'Acme', ?, 'new')
     ON CONFLICT(phone) DO UPDATE SET status='new', attempts=0, last_attempt_at=NULL`,
  ).run(phone, tz);
}

test('runner dials due leads up to the concurrency cap and binds the callSid', async () => {
  for (let i = 0; i < 3; i++) seedLead(`+1999000000${i}`);

  const dialed = [];
  const runner = new LeadRunner({
    hoursCheck: () => true,
    maxConcurrent: 4,
    originate: async ({ to, leadId }) => {
      const sid = `CA${leadId}`;
      dialed.push({ to, sid });
      return sid;
    },
  });

  runner.paused = false;
  await runner._tick();

  assert.ok(dialed.length >= 3, `dialed ${dialed.length}`);
  const one = dialed[0];
  assert.equal(runner.inFlight.get(one.sid) != null, true);
  assert.equal(lookupCall(one.sid)?.phone, one.to);

  // completing a call frees the slot and marks the lead done
  const leadId = runner.inFlight.get(one.sid);
  runner.onCallComplete(one.sid);
  assert.equal(runner.inFlight.has(one.sid), false);
  const row = db.prepare('SELECT status FROM leads WHERE id = ?').get(leadId);
  assert.equal(row.status, 'done');
});

test('a failed originate re-queues the lead', async () => {
  seedLead('+19995551234');
  const runner = new LeadRunner({
    hoursCheck: () => true,
    originate: async () => {
      throw new Error('twilio 500');
    },
  });
  runner.paused = false;
  await runner._tick();

  const row = db.prepare("SELECT status FROM leads WHERE phone = '+19995551234'").get();
  assert.equal(row.status, 'queued');
  assert.equal(runner.inFlight.size, 0);
});
