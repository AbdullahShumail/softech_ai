import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallSession } from '../src/call/session.js';
import { loadCampaign } from '../src/brain/campaign.js';
import { pcm16ToMulaw } from '../src/telephony/mulaw.js';

const campaign = loadCampaign('b2b-outreach');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeStream() {
  return {
    callSid: 'CAtest',
    customParameters: {},
    log: { info() {}, warn() {}, error() {} },
    onMedia: null,
    onMark: null,
    onClose: null,
    marks: [],
    cleared: 0,
    sendAudio() {},
    sendMark(name) {
      this.marks.push(name);
      queueMicrotask(() => this.onMark?.(name)); // Twilio echoes marks back
    },
    clear() {
      this.cleared++;
    },
  };
}

const fakeLibrary = { has: () => true, get: () => Buffer.alloc(1600) };

// count frames of mono PCM16 @ amplitude, as a base64 µ-law media payload
function payload(count, amplitude) {
  const pcm = Buffer.alloc(count * 160 * 2);
  for (let i = 0; i < count * 160; i++) pcm.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2);
  return pcm16ToMulaw(pcm).toString('base64');
}

test('media → endpointer → STT → classify → logic → playback loop advances a turn', async () => {
  const stream = fakeStream();
  const finals = [];
  const turns = [];

  const session = new CallSession({
    stream,
    library: fakeLibrary,
    campaign,
    callSid: 'CAtest',
    deps: {
      // deliberately ambiguous — must fall THROUGH the fast path to the LLM
      transcribe: async () => ({ text: 'well i suppose it depends really' }),
      classify: async () => ({ disposition: 'NEU', thought: 'noncommittal', decisionMaker: null }),
      transfer: async () => {},
      hangup: async () => {},
      onFinal: (s) => finals.push(s),
      repo: { recordTurn: (_id, t) => turns.push(t) },
      log: null,
      callId: 1,
    },
  });

  await session.start();
  assert.ok(stream.marks.some((m) => m.startsWith('done:')), 'greeting played');
  assert.equal(session.state.turn, 1);

  stream.onMedia({ payload: payload(6, 6000) }); // voiced → speech-start
  stream.onMedia({ payload: payload(40, 15) }); // silence → speech-end
  await delay(20);

  // turn 0 is the agent's greeting; exchanges start at turn 1
  assert.equal(turns[0].turn, 0, 'the opening line should be recorded');
  assert.ok(turns[0].agentText.length > 0, 'and should carry the words, not just a name');
  const exchanges = turns.filter((t) => t.turn > 0);
  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].disposition, 'NEU');
  assert.equal(exchanges[0].route, 'llm', 'ambiguous input must reach the classifier');
  assert.ok(exchanges[0].agentText.length > 0, 'the reply text should be resolved from the script');
  assert.equal(session.state.turn, 2, 'advanced to the pitch');
  assert.equal(session.state.pitchDelivered, true);
  assert.equal(finals.length, 0, 'call still going');
});

test('a DNC utterance ends the call and reports the disposition', async () => {
  const stream = fakeStream();
  const finals = [];

  const session = new CallSession({
    stream,
    library: fakeLibrary,
    campaign,
    callSid: 'CAtest2',
    deps: {
      transcribe: async () => ({ text: 'take me off your list and never call again' }),
      classify: async () => ({ disposition: 'DNC', thought: 'opt out', decisionMaker: null }),
      hangup: async () => {},
      onFinal: (s) => finals.push(s),
    },
  });

  await session.start();
  stream.onMedia({ payload: payload(6, 6000) });
  stream.onMedia({ payload: payload(40, 15) });
  await delay(20);

  assert.equal(finals.length, 1);
  assert.equal(finals[0].finalDisposition, 'DNC');
  assert.equal(session.done, true);
});

test('a near-silent capture is dropped before it reaches STT', async () => {
  const stream = fakeStream();
  let sttCalls = 0;

  const session = new CallSession({
    stream,
    library: fakeLibrary,
    campaign,
    callSid: 'CAquiet',
    deps: {
      transcribe: async () => {
        sttCalls++;
        return { text: 'Thank you.' }; // the classic Whisper silence hallucination
      },
      classify: async () => ({ disposition: 'NEU', thought: '', decisionMaker: null }),
      onFinal: () => {},
    },
  });

  await session.start();
  // Loud enough to trip the VAD, but never loud enough to be real speech.
  stream.onMedia({ payload: payload(30, 500) });
  stream.onMedia({ payload: payload(40, 15) });
  await delay(20);

  assert.equal(sttCalls, 0, 'room tone must not be sent to Whisper');
  assert.equal(session.done, false);
});

// ---- latency path ----

function build(deps, overrides = {}) {
  const stream = fakeStream();
  const seen = { turns: [], finals: [], events: [] };
  const session = new CallSession({
    stream,
    library: fakeLibrary,
    campaign,
    callSid: 'CAtest',
    deps: {
      transfer: async () => {},
      hangup: async () => {},
      onFinal: (s) => seen.finals.push(s),
      repo: { recordTurn: (_id, t) => seen.turns.push(t) },
      log: { event: (type, d) => seen.events.push({ type, ...d }), turn() {}, finalize() {} },
      callId: 1,
      ...deps,
    },
    ...overrides,
  });
  return { stream, session, seen };
}

const speak = async (stream) => {
  stream.onMedia({ payload: payload(6, 6000) }); // voiced → speech-start
  stream.onMedia({ payload: payload(40, 15) }); // silence → speech-end
  await delay(20);
};

test('an unambiguous reply never reaches the classifier', async () => {
  let classifyCalls = 0;
  const { stream, session, seen } = build({
    transcribe: async () => ({ text: 'we already have a guy who does that' }),
    classify: async () => {
      classifyCalls++;
      return { disposition: 'R', thought: 'should not run', decisionMaker: null };
    },
  });

  await session.start();
  await speak(stream);

  assert.equal(classifyCalls, 0, 'the fast path should have resolved this turn');
  const first = seen.turns.find((t) => t.turn > 0);
  assert.equal(first.disposition, 'HAS');
  assert.equal(first.route, 'fast');
});

test('a fast-path turn plays no acknowledgement token', async () => {
  const { stream, session } = build({
    transcribe: async () => ({ text: 'not interested thanks' }),
    classify: async () => ({ disposition: 'R', thought: '', decisionMaker: null }),
  });
  await session.start();
  await speak(stream);
  assert.ok(
    !stream.marks.some((m) => m.includes(':ack-')),
    'no wait is coming, so no ack should be played',
  );
});

test('a slow classifier is covered by an acknowledgement token', async () => {
  const { stream, session } = build({
    transcribe: async () => ({ text: 'well i suppose it depends really' }),
    classify: async () => {
      await delay(15);
      return { disposition: 'NEU', thought: 'noncommittal', decisionMaker: null };
    },
  });

  await session.start();
  stream.onMedia({ payload: payload(6, 6000) });
  stream.onMedia({ payload: payload(40, 15) });
  await delay(60);

  const ack = stream.marks.find((m) => m.includes(':ack-'));
  assert.ok(ack, `expected an ack mark, got ${JSON.stringify(stream.marks)}`);
  // and it must never become the resume point for a later barge-in
  assert.ok(!session.lastPrompts.some((p) => p.startsWith('ack-')));
});

test('a pause mid-sentence starts STT early, then throws it away', async () => {
  let sttCalls = 0;
  const { stream, session, seen } = build({
    transcribe: async () => {
      sttCalls++;
      return { text: 'well i suppose it depends really' };
    },
    classify: async () => ({ disposition: 'NEU', thought: '', decisionMaker: null }),
  });

  await session.start();
  stream.onMedia({ payload: payload(6, 6000) }); // speech-start
  stream.onMedia({ payload: payload(20, 15) }); // 400 ms silence → provisional
  await delay(5);
  assert.equal(sttCalls, 1, 'provisional end should have fired STT speculatively');

  stream.onMedia({ payload: payload(6, 6000) }); // they carry on → resume
  stream.onMedia({ payload: payload(40, 15) }); // real end
  await delay(30);

  assert.ok(seen.events.some((e) => e.type === 'stt-speculative-discarded'));
  assert.equal(sttCalls, 2, 'the resumed utterance needs a fresh transcription');
});

test('a clean stop reuses the speculative transcript instead of re-running STT', async () => {
  let sttCalls = 0;
  const { stream, session, seen } = build({
    transcribe: async () => {
      sttCalls++;
      return { text: 'well i suppose it depends really' };
    },
    classify: async () => ({ disposition: 'NEU', thought: '', decisionMaker: null }),
  });

  await session.start();
  stream.onMedia({ payload: payload(6, 6000) });
  stream.onMedia({ payload: payload(40, 15) }); // straight through provisional → commit
  await delay(30);

  assert.equal(sttCalls, 1, 'the committed turn must not transcribe a second time');
  assert.ok(seen.events.some((e) => e.type === 'stt-speculative-used'));
});

test('a backchannel resumes the pitch instead of restarting it', async () => {
  const { stream, session } = build({
    transcribe: async () => ({ text: 'mm hmm' }),
    classify: async () => ({ disposition: 'NEU', thought: '', decisionMaker: null }),
  });

  await session.start();
  // pretend we are midway through the split pitch and clip 1 already landed
  session.phase = 'speaking';
  session.lastPrompts = ['pitch-2', 'pitch-3'];
  session.barged = true;
  session.capturing = true;
  session.captureChunks = [Buffer.alloc(8000)];
  session.captureMs = 1000;
  session.capturePeakRms = 5000;
  session._onSpeechEnd();
  await delay(30);

  assert.deepEqual(session.lastPrompts, ['pitch-2', 'pitch-3'], 'must not rewind to pitch-1');
});

test('an ack longer than the wait it covers is skipped, not played', async () => {
  const slowAckLibrary = { has: () => true, get: () => Buffer.alloc(1600), durationMs: () => 1290 };
  const stream = fakeStream();
  const session = new CallSession({
    stream,
    library: slowAckLibrary,
    campaign,
    callSid: 'CAtest',
    deps: {
      transcribe: async () => ({ text: 'well i suppose it depends really' }),
      classify: async () => ({ disposition: 'NEU', thought: '', decisionMaker: null }),
      transfer: async () => {},
      hangup: async () => {},
      onFinal: () => {},
      log: null,
      callId: 1,
    },
  });

  await session.start();
  stream.onMedia({ payload: payload(6, 6000) });
  stream.onMedia({ payload: payload(40, 15) });
  await delay(40);

  assert.ok(
    !stream.marks.some((m) => m.includes(':ack-')),
    'a 1.29 s ack would make the turn slower than no ack at all',
  );
  assert.equal(session.state.turn, 2, 'the turn still completes normally');
});

test('with no closer configured, a qualified lead is captured, not mis-transferred', async () => {
  const stream = fakeStream();
  const finals = [];
  let transferCalls = 0;
  let hangupCalls = 0;

  const session = new CallSession({
    stream,
    library: fakeLibrary,
    campaign,
    callSid: 'CAtest',
    deps: {
      transcribe: async () => ({ text: 'well i suppose it depends really' }),
      classify: async () => ({ disposition: 'QUAL', thought: 'owner, engaged', decisionMaker: true }),
      transfer: async () => { transferCalls++; },
      transferEnabled: false, // CLOSER_NUMBER unset or a placeholder
      hangup: async () => { hangupCalls++; },
      onFinal: (s) => finals.push(s),
      log: null,
      callId: 1,
    },
  });

  await session.start();
  session.state.pitchDelivered = true;
  stream.onMedia({ payload: payload(6, 6000) });
  stream.onMedia({ payload: payload(40, 15) });
  await delay(40);

  assert.equal(transferCalls, 0, 'must not dial a closer that does not exist');
  assert.equal(hangupCalls, 1, 'the call should end cleanly instead');
  assert.equal(finals[0].finalDisposition, 'QUAL', 'still a qualified lead');
  assert.equal(finals[0].transferred, false);
  assert.equal(finals[0].captured, true);
  assert.ok(
    stream.marks.some((m) => m.includes('close-qualified')),
    'the caller must hear the capture close, not the transfer promise',
  );
  assert.ok(
    !stream.marks.some((m) => m.includes(':transfer')),
    'must never promise a hand-off it cannot make',
  );
});

test('with a real closer configured, the transfer still happens', async () => {
  const stream = fakeStream();
  let transferCalls = 0;
  const finals = [];
  const session = new CallSession({
    stream,
    library: fakeLibrary,
    campaign,
    callSid: 'CAtest',
    deps: {
      transcribe: async () => ({ text: 'well i suppose it depends really' }),
      classify: async () => ({ disposition: 'QUAL', thought: 'owner', decisionMaker: true }),
      transfer: async () => { transferCalls++; },
      transferEnabled: true,
      hangup: async () => {},
      onFinal: (s) => finals.push(s),
      log: null,
      callId: 1,
    },
  });

  await session.start();
  session.state.pitchDelivered = true;
  stream.onMedia({ payload: payload(6, 6000) });
  stream.onMedia({ payload: payload(40, 15) });
  await delay(40);

  assert.equal(transferCalls, 1);
  assert.equal(finals[0].transferred, true);
});
