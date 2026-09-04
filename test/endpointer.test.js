import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Endpointer } from '../src/vad/endpointer.js';

const FRAME = 160; // samples @ 8 kHz / 20 ms

function frame(amplitude) {
  const b = Buffer.alloc(FRAME * 2);
  for (let i = 0; i < FRAME; i++) {
    // alternating +/- so RMS ≈ amplitude regardless of frequency
    b.writeInt16LE(i % 2 ? amplitude : -amplitude, i * 2);
  }
  return b;
}

test('detects speech-start after startFrames voiced frames', () => {
  const ep = new Endpointer({ startFrames: 3 });
  assert.equal(ep.push(frame(30)), null); // quiet
  assert.equal(ep.push(frame(4000)), null); // 1
  assert.equal(ep.push(frame(4000)), null); // 2
  assert.deepEqual(ep.push(frame(4000)), { type: 'speech-start' }); // 3
});

test('detects speech-end after endFrames of silence', () => {
  const ep = new Endpointer({ startFrames: 2, endFrames: 5 });
  ep.push(frame(4000));
  ep.push(frame(4000)); // speech-start
  assert.equal(ep.inSpeech, true);

  let end = null;
  for (let i = 0; i < 5; i++) end = ep.push(frame(20));
  assert.deepEqual(end, { type: 'speech-end', reason: 'silence' });
  assert.equal(ep.inSpeech, false);
});

test('brief dips inside speech do not end the utterance', () => {
  const ep = new Endpointer({ startFrames: 2, endFrames: 10 });
  ep.push(frame(4000));
  ep.push(frame(4000));
  for (let i = 0; i < 3; i++) ep.push(frame(20)); // short pause
  assert.equal(ep.push(frame(4000)), null); // resumes, no end fired
  assert.equal(ep.inSpeech, true);
});

test('caps an over-long utterance with max-duration', () => {
  const ep = new Endpointer({ startFrames: 1, maxUtteranceMs: 100, frameMs: 20 });
  ep.push(frame(4000)); // start
  let out = null;
  for (let i = 0; i < 5; i++) out = ep.push(frame(4000));
  assert.deepEqual(out, { type: 'speech-end', reason: 'max-duration' });
});

test('noise floor adapts so a loud-ish room still triggers on real speech', () => {
  const ep = new Endpointer({ startFrames: 3 });
  for (let i = 0; i < 200; i++) ep.push(frame(300)); // steady room tone
  assert.ok(ep.noiseFloor > 250, `noiseFloor ${ep.noiseFloor}`);
  ep.push(frame(6000));
  ep.push(frame(6000));
  assert.deepEqual(ep.push(frame(6000)), { type: 'speech-start' });
});

test('strict mode needs far more voiced frames (rejects bot echo)', () => {
  const ep = new Endpointer({ startFrames: 3, strictStartFrames: 18 });
  ep.setStrict(true);
  // a short burst that WOULD trigger in relaxed mode must not trigger in strict
  for (let i = 0; i < 10; i++) assert.equal(ep.push(frame(8000)), null, `frame ${i}`);
  assert.equal(ep.inSpeech, false);
  // sustained real speech still gets through
  let started = null;
  for (let i = 0; i < 12 && !started; i++) started = ep.push(frame(8000));
  assert.deepEqual(started, { type: 'speech-start' });
});

test('strict mode also raises the loudness bar', () => {
  const relaxed = new Endpointer();
  const strict = new Endpointer();
  strict.setStrict(true);
  assert.ok(strict.threshold > relaxed.threshold, `${strict.threshold} !> ${relaxed.threshold}`);
});

// ---- speculative endpointing ----

test('a provisional end fires early but does not leave speech', () => {
  const ep = new Endpointer({ startFrames: 2, provisionalFrames: 3, endFrames: 10 });
  ep.push(frame(4000));
  ep.push(frame(4000)); // speech-start

  assert.equal(ep.push(frame(20)), null); // 1
  assert.equal(ep.push(frame(20)), null); // 2
  assert.deepEqual(ep.push(frame(20)), { type: 'speech-end', reason: 'provisional' });
  assert.equal(ep.inSpeech, true, 'provisional must not end the utterance');
});

test('carrying on after a provisional end fires speech-resume', () => {
  const ep = new Endpointer({ startFrames: 2, provisionalFrames: 3, endFrames: 10 });
  ep.push(frame(4000));
  ep.push(frame(4000));
  for (let i = 0; i < 3; i++) ep.push(frame(20)); // → provisional

  assert.deepEqual(ep.push(frame(4000)), { type: 'speech-resume' });
  assert.equal(ep.inSpeech, true);
});

test('provisional fires once per pause, not on every silent frame', () => {
  const ep = new Endpointer({ startFrames: 2, provisionalFrames: 3, endFrames: 20 });
  ep.push(frame(4000));
  ep.push(frame(4000));
  let provisionals = 0;
  for (let i = 0; i < 10; i++) {
    if (ep.push(frame(20))?.reason === 'provisional') provisionals++;
  }
  assert.equal(provisionals, 1);
});

test('a pause then more speech re-arms the provisional', () => {
  const ep = new Endpointer({ startFrames: 2, provisionalFrames: 3, endFrames: 20 });
  ep.push(frame(4000));
  ep.push(frame(4000));
  for (let i = 0; i < 3; i++) ep.push(frame(20)); // provisional #1
  ep.push(frame(4000)); // resume
  let out = null;
  for (let i = 0; i < 3; i++) out = ep.push(frame(20));
  assert.deepEqual(out, { type: 'speech-end', reason: 'provisional' }, 'second pause re-arms');
});

test('silence past endFrames still commits after a provisional', () => {
  const ep = new Endpointer({ startFrames: 2, provisionalFrames: 3, endFrames: 6 });
  ep.push(frame(4000));
  ep.push(frame(4000));
  let out = null;
  for (let i = 0; i < 6; i++) out = ep.push(frame(20));
  assert.deepEqual(out, { type: 'speech-end', reason: 'silence' });
  assert.equal(ep.inSpeech, false);
});

// ---- start debounce ----

test('a one-frame dip does not discard the voiced run', () => {
  const ep = new Endpointer({ startFrames: 4, startGapFrames: 2 });
  ep.push(frame(4000)); // 1
  ep.push(frame(4000)); // 2
  ep.push(frame(20)); // dip — tolerated, run survives
  ep.push(frame(4000)); // 3
  assert.deepEqual(ep.push(frame(4000)), { type: 'speech-start' }); // 4
});

test('a long gap still discards the run', () => {
  const ep = new Endpointer({ startFrames: 3, startGapFrames: 1 });
  ep.push(frame(4000));
  ep.push(frame(4000));
  ep.push(frame(20));
  ep.push(frame(20)); // past the tolerance — run is dead
  ep.push(frame(4000)); // counts as 1 again
  assert.equal(ep.push(frame(4000)), null); // 2 — not yet
  assert.deepEqual(ep.push(frame(4000)), { type: 'speech-start' }); // 3
});

test('strict mode tolerates less gap than relaxed mode', () => {
  const ep = new Endpointer();
  assert.equal(ep.allowedStartGap, 2);
  ep.setStrict(true);
  assert.equal(ep.allowedStartGap, 1);
});
