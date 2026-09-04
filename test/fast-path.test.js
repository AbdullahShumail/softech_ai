import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fastPath } from '../src/brain/fast-path.js';
import { DISPOSITIONS } from '../src/brain/dispositions.js';

const d = (text, ctx) => fastPath(text, ctx)?.disposition ?? null;

test('every code the fast path can emit is a real disposition', () => {
  const samples = [
    'take me off your list', 'fuck off', 'i do not speak english',
    "i'm not the owner", 'i am the owner', 'not interested',
    'we have a guy', 'we just rebuilt it', 'too expensive',
    'word of mouth', 'let me think about it', 'call me back',
    "i'm busy", 'are you a bot', 'who is this', 'how did you get my number',
    'how much does it cost', 'is this a scam', 'send me an email',
    "we don't have a website", 'sounds interesting', 'hold on',
  ];
  for (const s of samples) {
    const code = d(s);
    assert.ok(code, `no fast-path hit for "${s}"`);
    assert.ok(DISPOSITIONS[code], `"${s}" produced unknown code ${code}`);
  }
});

test('do-not-call is caught deterministically, not left to the LLM', () => {
  for (const s of ['take me off your list', 'remove me from your list',
                   'do not call me again', 'stop calling', 'please unsubscribe me']) {
    assert.equal(d(s), 'DNC', s);
  }
});

test('"we have a website" is an answer, not a HAS objection', () => {
  // the HAS rule has to name a person or vendor, or it swallows plain answers
  assert.notEqual(d('yes we have a website'), 'HAS');
  assert.notEqual(d('i have a website already'), 'HAS');
  assert.equal(d('we have a guy who does it'), 'HAS');
  assert.equal(d('our agency handles that'), 'HAS');
});

test('having no website beats every objection rule', () => {
  for (const s of ["we don't have a website", 'no website at all',
                   'we never had a site', 'just a facebook page']) {
    assert.equal(d(s), 'NOSITE', s);
  }
});

test('site age is extracted from however it is phrased', () => {
  const age = (s) => fastPath(s)?.hints?.siteAgeYears ?? null;
  assert.equal(age('about 5 years'), 5);
  assert.equal(age('five years old i think'), 5);
  assert.equal(age('six months'), 0.5);
  assert.equal(age('since 2019'), new Date().getFullYear() - 2019);
  assert.equal(age('we built it in 2015'), new Date().getFullYear() - 2015);
  assert.equal(age('honestly no idea'), 99); // vague-but-old still routes to the dated pitch
});

test('site age is only read while the opening question is still open', () => {
  assert.equal(fastPath('about 5 years', { pitchDelivered: true }), null);
  assert.equal(fastPath('about 5 years', { pitchDelivered: false })?.disposition, 'NEU');
});

test('a bare yes/no only resolves when we asked who decides', () => {
  assert.equal(fastPath('yes'), null); // meaningless without context
  assert.equal(fastPath('no'), null);

  const ctx = { awaitingDecisionMaker: true };
  assert.deepEqual(
    [d('yes', ctx), fastPath('yes', ctx).decisionMaker],
    ['DM', true],
  );
  assert.deepEqual(
    [d('nope', ctx), fastPath('nope', ctx).decisionMaker],
    ['NDM', false],
  );
});

test('decision-maker phrasing carries the flag, not just the code', () => {
  assert.equal(fastPath("i'm the owner").decisionMaker, true);
  assert.equal(fastPath('this is me').decisionMaker, true);
  assert.equal(fastPath("i'm not the owner").decisionMaker, false);
  assert.equal(fastPath('my boss handles that').decisionMaker, false);
});

test('a genuine price question is PRICE, a dismissal is BUDGET', () => {
  assert.equal(d('how much does it cost'), 'PRICE');
  assert.equal(d('what is your rate'), 'PRICE');
  assert.equal(d('that sounds too expensive'), 'BUDGET');
  assert.equal(d('we have no budget for that'), 'BUDGET');
});

test('ambiguous input falls through to the classifier', () => {
  for (const s of ['well i mean it depends', 'hmm let me see here',
                   'my cousin was asking about that the other day', 'what about tuesday']) {
    assert.equal(fastPath(s), null, `"${s}" should not have matched`);
  }
});

test('empty and junk input never produces a code', () => {
  for (const s of ['', '   ', null, undefined]) {
    assert.equal(fastPath(s), null);
  }
});
