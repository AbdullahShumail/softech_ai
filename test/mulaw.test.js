import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeSample,
  decodeSample,
  pcm16ToMulaw,
  mulawToPcm16,
} from '../src/telephony/mulaw.js';

test('silence encodes to 0xFF and decodes back to ~0', () => {
  assert.equal(encodeSample(0), 0xff);
  assert.equal(decodeSample(0xff), 0);
});

test('sign is preserved through a round trip', () => {
  for (const s of [-30000, -8000, -100, 100, 8000, 30000]) {
    const rt = decodeSample(encodeSample(s));
    assert.equal(Math.sign(rt), Math.sign(s), `sign mismatch for ${s} -> ${rt}`);
  }
});

test('round trip stays within µ-law quantization error', () => {
  // µ-law is lossy; near full-scale the step is a few hundred. Allow 4%.
  for (let s = -32000; s <= 32000; s += 250) {
    const rt = decodeSample(encodeSample(s));
    const tol = Math.max(64, Math.abs(s) * 0.04);
    assert.ok(Math.abs(rt - s) <= tol, `|${rt} - ${s}| > ${tol}`);
  }
});

test('every µ-law byte round-trips to a stable sample', () => {
  // 0x7F is negative-zero in G.711 and aliases to 0xFF (positive zero) on re-encode.
  // The invariant that always holds: decoding the re-encoded byte gives the same sample.
  for (let b = 0; b < 256; b++) {
    const sample = decodeSample(b);
    const again = decodeSample(encodeSample(sample));
    assert.equal(again, sample, `byte ${b} sample ${sample} -> ${again}`);
  }
});

test('buffer helpers: length relationships and a 20ms frame', () => {
  const pcm = Buffer.alloc(320); // 160 samples PCM16 = one Twilio frame
  pcm.writeInt16LE(12345, 0);
  pcm.writeInt16LE(-9876, 2);

  const mu = pcm16ToMulaw(pcm);
  assert.equal(mu.length, 160);

  const back = mulawToPcm16(mu);
  assert.equal(back.length, 320);

  assert.ok(Math.abs(back.readInt16LE(0) - 12345) <= 12345 * 0.04);
  assert.ok(Math.abs(back.readInt16LE(2) - -9876) <= 9876 * 0.04);
});
