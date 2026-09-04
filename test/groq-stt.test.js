import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribeMulaw } from '../src/asr/groq-stt.js';

const silence = Buffer.alloc(4000, 0xff); // µ-law zero

function fakeClient(response, captured = {}) {
  return {
    audio: {
      transcriptions: {
        create: async (args) => {
          Object.assign(captured, args);
          return response;
        },
      },
    },
  };
}

// A confident real utterance: low no_speech_prob, high (near-zero) avg_logprob.
const heard = {
  text: 'we built it in 2019',
  segments: [{ start: 0, end: 1.4, no_speech_prob: 0.02, avg_logprob: -0.18 }],
};

test('a confident transcript passes through', async () => {
  const r = await transcribeMulaw(silence, { client: fakeClient(heard) });
  assert.equal(r.text, 'we built it in 2019');
  assert.equal(r.dropped, undefined);
});

test('text the model itself says is not speech is dropped', async () => {
  // this is exactly the shape of "Love" / "Peppol" decoded from line noise
  const invented = {
    text: 'Love',
    segments: [{ start: 0, end: 0.9, no_speech_prob: 0.93, avg_logprob: -0.31 }],
  };
  const r = await transcribeMulaw(silence, { client: fakeClient(invented) });
  assert.equal(r.text, '', 'must not reach the classifier');
  assert.equal(r.dropped, 'low-confidence');
  assert.equal(r.rawText, 'Love', 'but keep it for the logs');
});

test('fluent-but-unconfident text is dropped', async () => {
  const invented = {
    text: 'and I am going to be able to get a ticket',
    segments: [{ start: 0, end: 2.0, no_speech_prob: 0.2, avg_logprob: -1.4 }],
  };
  const r = await transcribeMulaw(silence, { client: fakeClient(invented) });
  assert.equal(r.dropped, 'low-confidence');
});

test('confidence is averaged over segment duration, not per segment', async () => {
  // one short junk segment must not condemn a long confident utterance
  const mixed = {
    text: 'we have an agency that handles all of that for us already',
    segments: [
      { start: 0, end: 4.0, no_speech_prob: 0.02, avg_logprob: -0.2 },
      { start: 4.0, end: 4.15, no_speech_prob: 0.95, avg_logprob: -1.6 },
    ],
  };
  const r = await transcribeMulaw(silence, { client: fakeClient(mixed) });
  assert.equal(r.text, 'we have an agency that handles all of that for us already');
});

test('a response without segment data is trusted', async () => {
  // older API shape / stubbed clients must not be silently blanked
  const r = await transcribeMulaw(silence, { client: fakeClient({ text: 'not interested' }) });
  assert.equal(r.text, 'not interested');
});

test('language is pinned and verbose output requested', async () => {
  const captured = {};
  await transcribeMulaw(silence, { client: fakeClient(heard, captured), prompt: 'caller words' });
  assert.equal(captured.language, 'en', 'auto-detect drifts to other languages on accented audio');
  assert.equal(captured.response_format, 'verbose_json', 'needed for the confidence check');
  assert.equal(captured.temperature, 0);
  assert.equal(captured.prompt, 'caller words');
});

test('an STT failure returns empty text rather than throwing into the call', async () => {
  const boom = {
    audio: { transcriptions: { create: async () => { throw new Error('502 upstream'); } } },
  };
  const r = await transcribeMulaw(silence, { client: boom });
  assert.equal(r.text, '');
  assert.equal(r.error, '502 upstream');
});
