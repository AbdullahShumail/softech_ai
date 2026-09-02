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
      transcribe: async () => ({ text: "yeah okay what's this about" }),
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

  assert.equal(turns.length, 1);
  assert.equal(turns[0].disposition, 'NEU');
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
