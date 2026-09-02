import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenTranscript, isVoicemail, isFragment } from '../src/asr/gates.js';
import { isHallucinationPhrase } from '../src/asr/hallucination-denylist.js';

test('hallucination phrases are caught', () => {
  for (const p of ['Thank you.', 'thanks for watching!', 'you', '.', 'Subtitles by the Amara.org community']) {
    assert.equal(isHallucinationPhrase(p), true, p);
  }
  assert.equal(isHallucinationPhrase('we use wordpress and it is slow'), false);
});

test('voicemail greetings are detected', () => {
  assert.equal(isVoicemail('please leave a message after the tone'), true);
  assert.equal(isVoicemail("you've reached the voicemail of Dave"), true);
  assert.equal(isVoicemail('yeah this is Dave speaking'), false);
});

test('fragments: short noise dropped, meaningful short answers kept', () => {
  assert.equal(isFragment('uh'), true);
  assert.equal(isFragment('the'), true);
  assert.equal(isFragment('yes'), false);
  assert.equal(isFragment('no'), false);
  assert.equal(isFragment('take me off'), false);
  assert.equal(isFragment('we have 40 people'), false);
  assert.equal(isFragment('who is this?'), false);
});

test('screenTranscript routing', () => {
  assert.deepEqual(screenTranscript(''), { ok: false, reason: 'empty' });
  assert.equal(screenTranscript('thank you').reason, 'hallucination');
  assert.equal(screenTranscript('leave a message after the beep').reason, 'voicemail');
  assert.equal(screenTranscript('um').reason, 'hallucination'); // denylist wins over fragment
  assert.equal(screenTranscript('yo').reason, 'fragment');
  assert.deepEqual(screenTranscript("no I'm not interested"), {
    ok: true,
    text: "no I'm not interested",
  });
});
