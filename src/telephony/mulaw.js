// G.711 µ-law (mu-law) codec — ITU-T G.711.
//
// Twilio Media Streams carries 8 kHz mono µ-law, 20 ms frames = 160 samples = 160 bytes.
// Inbound: decode to PCM16 for VAD + STT. Outbound: encode PCM16 prompt audio to µ-law.

const BIAS = 0x84;
const CLIP = 32635;

/** PCM16 sample (-32768..32767) -> µ-law byte (0..255). */
export function encodeSample(sample) {
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {
    /* find highest set bit */
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** µ-law byte (0..255) -> PCM16 sample. */
export function decodeSample(muLawByte) {
  const u = ~muLawByte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;

  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign && sample !== 0 ? -sample : sample;
}

/** Buffer of PCM16LE -> Buffer of µ-law (half the length). */
export function pcm16ToMulaw(pcm) {
  const out = Buffer.allocUnsafe(pcm.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = encodeSample(pcm.readInt16LE(i * 2));
  }
  return out;
}

/** Buffer of µ-law -> Buffer of PCM16LE (double the length). */
export function mulawToPcm16(mulaw) {
  const out = Buffer.allocUnsafe(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    out.writeInt16LE(decodeSample(mulaw[i]), i * 2);
  }
  return out;
}
