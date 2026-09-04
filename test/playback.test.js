import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Playback } from '../src/audio/playback.js';

function fakeSession() {
  return {
    log: { warn() {}, info() {} },
    sent: [],
    marks: [],
    cleared: 0,
    sendAudio(buf) {
      this.sent.push(buf.length);
    },
    sendMark(name) {
      this.marks.push(name);
    },
    clear() {
      this.cleared++;
    },
  };
}

function fakeLibrary(map) {
  return {
    has: (n) => map.has(n),
    get: (n) => map.get(n) ?? null,
  };
}

const lib = fakeLibrary(
  new Map([
    ['greeting', Buffer.alloc(9000)], // > one chunk
    ['pitch', Buffer.alloc(2000)],
  ]),
);

test('play sends chunked audio, a seg mark per prompt, and a final done mark', async () => {
  const s = fakeSession();
  const pb = new Playback(s, lib);
  const p = pb.play(['greeting', 'pitch']);

  assert.equal(s.sent.length, 4, 'greeting 9000 -> 3 chunks (4000+4000+1000), pitch 2000 -> 1');
  assert.deepEqual(s.marks, ['seg:1:greeting', 'seg:1:pitch', 'done:1']);
  assert.equal(pb.isPlaying, true);

  pb.onMark('done:1');
  assert.deepEqual(await p, { completed: true, played: ['greeting', 'pitch'], remaining: [] });
  assert.equal(pb.isPlaying, false);
});

test('a stale mark from a superseded generation is ignored', async () => {
  const s = fakeSession();
  const pb = new Playback(s, lib);
  const first = pb.play('greeting');
  const second = pb.play('pitch'); // supersedes gen 1

  assert.deepEqual(await first, { completed: false, played: ['greeting'], remaining: ['greeting'] });
  assert.equal(s.cleared, 1);

  pb.onMark('done:1'); // stale — must not resolve `second`
  let secondDone = false;
  second.then(() => (secondDone = true));
  await Promise.resolve();
  assert.equal(secondDone, false);

  pb.onMark('done:2');
  assert.deepEqual(await second, { completed: true, played: ['pitch'], remaining: [] });
});

test('interrupt flushes Twilio buffer and resolves the pending play as not completed', async () => {
  const s = fakeSession();
  const pb = new Playback(s, lib);
  const p = pb.play('greeting');
  pb.interrupt();
  assert.equal(s.cleared, 1);
  assert.deepEqual(await p, { completed: false, played: ['greeting'], remaining: ['greeting'] });
});

test('missing prompts are skipped; all-missing resolves immediately as completed', async () => {
  const s = fakeSession();
  const pb = new Playback(s, lib);
  assert.deepEqual(await pb.play(['nope', 'still-nope']), { completed: true, played: [], remaining: [] });
  assert.equal(s.marks.length, 0);
});

test('interrupt with nothing playing does not send clear', () => {
  const s = fakeSession();
  const pb = new Playback(s, lib);
  pb.interrupt();
  assert.equal(s.cleared, 0);
});

const splitLib = fakeLibrary(
  new Map([
    ['pitch-1', Buffer.alloc(1000)],
    ['pitch-2', Buffer.alloc(1000)],
    ['pitch-3', Buffer.alloc(1000)],
  ]),
);

test('a barge-in reports the clips the caller never heard', async () => {
  const session = fakeSession();
  const pb = new Playback(session, splitLib);
  const p = pb.play(['pitch-1', 'pitch-2', 'pitch-3']);

  // Twilio echoes a seg mark as each clip finishes playing out
  pb.onMark(`seg:${pb.gen}:pitch-1`);
  pb.onMark(`seg:${pb.gen}:pitch-2`);
  pb.interrupt(); // caller cuts in during clip 3

  const r = await p;
  assert.equal(r.completed, false);
  assert.deepEqual(r.remaining, ['pitch-3'], 'only the unheard clip should resume');
  assert.ok(session.cleared > 0, 'barge-in must flush Twilio buffer');
});

test('a barge-in before any clip finishes replays the whole thing', async () => {
  const pb = new Playback(fakeSession(), splitLib);
  const p = pb.play(['pitch-1', 'pitch-2']);
  pb.interrupt();
  assert.deepEqual((await p).remaining, ['pitch-1', 'pitch-2']);
});
