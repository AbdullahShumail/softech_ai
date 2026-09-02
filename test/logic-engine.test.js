import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, freshState } from '../src/brain/logic-engine.js';
import { loadCampaign } from '../src/brain/campaign.js';

const campaign = loadCampaign('b2b-outreach');
const step = (disp, dm, state) => {
  const r = decide(disp, dm, state, campaign);
  return { r, next: { ...state, ...r.updates } };
};

test('turn 1: neutral response advances to the pitch', () => {
  const { r, next } = step('NEU', null, freshState());
  assert.equal(r.action, 'continue');
  assert.deepEqual(r.prompts, ['pitch']);
  assert.equal(next.turn, 2);
  assert.equal(next.pitchDelivered, true);
});

test('turn 1: a reflexive brush-off is bulldozed once, then closed', () => {
  let s = freshState();
  let out = step('NI', null, s);
  assert.equal(out.r.prompts[0], 'pitch');
  assert.equal(out.next.bulldozedT1, true);

  // pretend we looped back to turn 1 somehow and they brush off again
  out = step('NI', null, { ...out.next, turn: 1 });
  assert.equal(out.r.action, 'hangup');
  assert.equal(out.r.finalDisposition, 'NI');
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
  assert.deepEqual(r.prompts, ['reb-has']);
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
