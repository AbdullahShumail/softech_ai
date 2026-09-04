import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, freshState } from '../src/brain/logic-engine.js';
import { loadCampaign } from '../src/brain/campaign.js';

const campaign = loadCampaign('b2b-outreach');
const step = (disp, dm, state, hints = {}) => {
  const r = decide(disp, dm, state, campaign, hints);
  return { r, next: { ...state, ...r.updates } };
};

test('turn 1: neutral response advances to the pitch', () => {
  const { r, next } = step('NEU', null, freshState());
  assert.equal(r.action, 'continue');
  // the answer is acknowledged before the pitch, not steamrolled
  assert.deepEqual(r.prompts, ['great', 'pitch-1', 'pitch-2', 'pitch-3']);
  assert.equal(next.turn, 2);
  assert.equal(next.pitchDelivered, true);
});

test('turn 1: a reflexive brush-off is bulldozed once, then closed', () => {
  let s = freshState();
  let out = step('NI', null, s);
  assert.equal(out.r.prompts[0], 'pitch-1');
  assert.equal(out.next.bulldozedT1, true);

  // pretend we looped back to turn 1 somehow and they brush off again: now
  // that the pitch is spent, they get the ladder rather than another pitch
  out = step('NI', null, { ...out.next, turn: 1 });
  assert.equal(out.r.action, 'continue');
  assert.deepEqual(out.r.prompts, ['reb-ni-1']);
});

test('DNC at any turn ends the call', () => {
  const { r } = step('DNC', null, { ...freshState(), turn: 2 });
  assert.equal(r.action, 'hangup');
  assert.equal(r.finalDisposition, 'DNC');
  assert.deepEqual(r.prompts, ['close-dnc']);
});

test('answering machine → voicemail message + hangup', () => {
  const { r } = step('AM', null, freshState());
  assert.equal(r.action, 'hangup');
  assert.deepEqual(r.prompts, ['voicemail-message']);
});

test('qualified path: interested + decision maker + pitch delivered → transfer', () => {
  let s = { ...freshState(), turn: 2, pitchDelivered: true };
  const { r } = step('QUAL', true, s);
  assert.equal(r.action, 'transfer');
  assert.equal(r.finalDisposition, 'QUAL');
  assert.deepEqual(r.prompts, ['transfer']);
});

test('interested but decision maker unknown → qualify first, no transfer yet', () => {
  const s = { ...freshState(), turn: 2, pitchDelivered: true };
  const { r, next } = step('INT', null, s);
  assert.equal(r.action, 'continue');
  assert.deepEqual(r.prompts, ['ask-decision-maker']);
  assert.equal(next.awaitingDecisionMaker, true);
});

test('NDM once asks for the decision maker; twice ends the call', () => {
  let out = step('NDM', null, freshState());
  assert.deepEqual(out.r.prompts, ['ask-decision-maker']);
  assert.equal(out.next.awaitingDecisionMaker, true);

  out = step('NDM', null, out.next);
  assert.equal(out.r.action, 'hangup');
  assert.equal(out.r.finalDisposition, 'NDM');
});

test('turn 2 objection → rebuttal, moves to turn 3', () => {
  const s = { ...freshState(), turn: 2, pitchDelivered: true };
  const { r, next } = step('HAS', null, s);
  assert.deepEqual(r.prompts, ['reb-has-1']);
  assert.equal(next.turn, 3);
  assert.equal(next.rebuttalCount, 1);
});

test('turn 3 rebuttals are capped, then the call closes', () => {
  let s = { ...freshState(), turn: 3, pitchDelivered: true, rebuttalCount: 3 };
  const { r } = step('BUDGET', null, s);
  assert.equal(r.action, 'hangup');
  assert.deepEqual(r.prompts, ['close-not-interested']);
});

test('a question is answered and control returns to the same point', () => {
  const s = { ...freshState(), turn: 2, pitchDelivered: true };
  const { r, next } = step('WHO', null, s);
  assert.equal(r.action, 'continue');
  assert.deepEqual(r.prompts, ['ans-who', 'pitch-followup']);
  assert.equal(next.questionCount, 1);
  assert.equal(next.turn, 2);
});

test('unclear input reprompts, then hangs up after 3 in a row', () => {
  let s = freshState();
  for (let i = 0; i < 2; i++) {
    const out = step('R', null, s);
    assert.deepEqual(out.r.prompts, ['reprompt']);
    s = out.next;
  }
  const { r } = step('R', null, s);
  assert.equal(r.action, 'hangup');
  assert.equal(r.finalDisposition, 'R');
});

test('WAIT acknowledges without advancing the turn', () => {
  const s = { ...freshState(), turn: 2 };
  const { r, next } = step('WAIT', null, s);
  assert.equal(r.action, 'continue');
  assert.deepEqual(r.prompts, ['wait-ack']);
  assert.equal(next.turn, 2);
});

// ---- rebuttal ladders ----

test('the same objection never hears the same rebuttal twice', () => {
  let s = { ...freshState(), turn: 3, pitchDelivered: true };
  const heard = [];
  for (let i = 0; i < 3; i++) {
    const out = step('NI', null, s);
    assert.equal(out.r.action, 'continue', `rung ${i} should still be climbing`);
    heard.push(out.r.prompts[0]);
    s = out.next;
  }
  assert.deepEqual(heard, ['reb-ni-1', 'reb-ni-2', 'reb-ni-3']);
  assert.equal(new Set(heard).size, 3);
});

test('a spent ladder closes rather than repeating its last rung', () => {
  // THINK has a single rung; the second THINK must not replay it
  let s = { ...freshState(), turn: 3, pitchDelivered: true };
  let out = step('THINK', null, s);
  assert.deepEqual(out.r.prompts, ['reb-think-1']);

  out = step('THINK', null, out.next);
  assert.equal(out.r.action, 'hangup');
  assert.deepEqual(out.r.prompts, ['close-callback']);
});

test('each objection code starts at its own rung 0', () => {
  let s = { ...freshState(), turn: 3, pitchDelivered: true };
  let out = step('NI', null, s);
  assert.deepEqual(out.r.prompts, ['reb-ni-1']);

  // a different objection must not inherit NI's position on the ladder
  out = step('BUDGET', null, out.next);
  assert.deepEqual(out.r.prompts, ['reb-budget-1']);
  assert.equal(out.next.rebuttalCount, 2);
  assert.deepEqual(out.next.usedRebuttals, { NI: 1, BUDGET: 1 });
});

test('the global rebuttal cap still ends the call mid-ladder', () => {
  // NI has 3 rungs but the campaign cap is 3 total, already spent
  const s = { ...freshState(), turn: 3, pitchDelivered: true, rebuttalCount: 3, usedRebuttals: {} };
  const { r } = step('NI', null, s);
  assert.equal(r.action, 'hangup');
});

// ---- new dispositions ----

test('no website at all pitches and qualifies in one turn', () => {
  const { r, next } = step('NOSITE', null, freshState());
  assert.equal(r.action, 'continue');
  assert.deepEqual(r.prompts, ['pitch-nosite', 'ask-decision-maker']);
  assert.equal(next.interested, true);
  assert.equal(next.pitchDelivered, true);
  assert.equal(next.awaitingDecisionMaker, true);
});

test('owning up after being asked who decides triggers the transfer', () => {
  // NOSITE set interest + asked who decides; they say it is them
  const { next } = step('NOSITE', null, freshState());
  const { r } = step('DM', true, next);
  assert.equal(r.action, 'transfer');
  assert.equal(r.finalDisposition, 'QUAL');
});

test('"I am busy" gets one save before the pitch, then is respected', () => {
  let out = step('TIME', null, freshState());
  assert.equal(out.r.action, 'continue');
  assert.deepEqual(out.r.prompts, ['reb-time-1', 'pitch-1', 'pitch-3']);

  out = step('TIME', null, out.next);
  assert.equal(out.r.action, 'hangup');
  assert.equal(out.r.finalDisposition, 'TIME');
});

test('a known-old site opens the pitch by naming it', () => {
  const { r } = step('NEU', null, freshState(), { siteAgeYears: 5 });
  assert.deepEqual(r.prompts, ['great', 'pitch-dated', 'pitch-2', 'pitch-3']);
});

test('a recent site gets the generic pitch, not the dated opener', () => {
  const { r } = step('NEU', null, freshState(), { siteAgeYears: 1 });
  assert.deepEqual(r.prompts, ['great', 'pitch-1', 'pitch-2', 'pitch-3']);
});

test('price and proof questions have their own answers', () => {
  const s = { ...freshState(), turn: 2, pitchDelivered: true };
  assert.deepEqual(step('PRICE', null, s).r.prompts, ['ans-price', 'pitch-followup']);
  assert.deepEqual(step('PROOF', null, s).r.prompts, ['ans-proof', 'pitch-followup']);
});
