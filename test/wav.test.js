import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWav, wavToMulaw8k } from '../src/audio/wav.js';
import { mulawToPcm16 } from '../src/telephony/mulaw.js';

// Build a PCM16 mono WAV of a sine tone.
function makeWav(sampleRate, seconds, freq = 440, channels = 1) {
  const frames = Math.round(sampleRate * seconds);
  const dataLen = frames * channels * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < frames; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 20000);
    for (let c = 0; c < channels; c++) buf.writeInt16LE(s, 44 + (i * channels + c) * 2);
  }
  return buf;
}

test('parseWav reads fmt and data', () => {
  const { fmt, data } = parseWav(makeWav(16000, 0.5));
  assert.equal(fmt.sampleRate, 16000);
  assert.equal(fmt.channels, 1);
  assert.equal(fmt.bitsPerSample, 16);
  assert.equal(data.length, 16000 * 0.5 * 2);
});

test('wavToMulaw8k: 8 kHz input passes through at 1 byte/sample', () => {
  const mu = wavToMulaw8k(makeWav(8000, 1.0));
  assert.equal(mu.length, 8000); // 1 s @ 8 kHz µ-law
});

test('wavToMulaw8k: 24 kHz input is resampled to 8 kHz', () => {
  const mu = wavToMulaw8k(makeWav(24000, 1.0));
  assert.ok(Math.abs(mu.length - 8000) <= 2, `got ${mu.length}`);
});

test('wavToMulaw8k: stereo is downmixed to mono', () => {
  const mu = wavToMulaw8k(makeWav(8000, 0.5, 440, 2));
  assert.equal(mu.length, 4000);
});

test('a decoded tone keeps roughly its amplitude through the round trip', () => {
  const pcm = mulawToPcm16(wavToMulaw8k(makeWav(8000, 0.2, 300)));
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  assert.ok(peak > 15000 && peak < 25000, `peak ${peak} outside expected band`);
});

test('parseWav rejects non-WAV input', () => {
  assert.throws(() => parseWav(Buffer.from('not a wav at all............')));
});
