import { pcm16ToMulaw } from '../telephony/mulaw.js';

// Minimal WAV reader → 8 kHz mono µ-law for Twilio Media Streams.
// Handles PCM 8/16/24/32-bit int and 32-bit IEEE float, mono or stereo, any rate.

export function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let offset = 12;
  let fmt = null;
  let dataStart = -1;
  let dataLen = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataStart = body;
      dataLen = Math.min(size, buf.length - body);
    }
    offset = body + size + (size & 1); // chunks are word-aligned
  }

  if (!fmt) throw new Error('missing fmt chunk');
  if (dataStart < 0) throw new Error('missing data chunk');
  return { fmt, data: buf.subarray(dataStart, dataStart + dataLen) };
}

function readMonoFloat({ fmt, data }) {
  const { audioFormat, channels, bitsPerSample } = fmt;
  const bytesPerSample = bitsPerSample >> 3;
  const stride = bytesPerSample * channels;
  const frames = Math.floor(data.length / stride);
  const out = new Float32Array(frames);

  const readOne = (o) => {
    if (audioFormat === 3 && bitsPerSample === 32) return data.readFloatLE(o);
    if (audioFormat === 1) {
      switch (bitsPerSample) {
        case 8:
          return (data.readUInt8(o) - 128) / 128; // 8-bit PCM is unsigned
        case 16:
          return data.readInt16LE(o) / 32768;
        case 24: {
          const v = data.readUIntLE(o, 3);
          return (v >= 0x800000 ? v - 0x1000000 : v) / 8388608;
        }
        case 32:
          return data.readInt32LE(o) / 2147483648;
      }
    }
    throw new Error(`unsupported WAV: format ${audioFormat}, ${bitsPerSample}-bit`);
  };

  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) acc += readOne(i * stride + c * bytesPerSample);
    out[i] = acc / channels;
  }
  return out;
}

function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.max(0, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = src - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/** PCM16LE Buffer (mono) at any rate → 8 kHz mono µ-law Buffer. */
export function pcm16ToMulaw8k(pcm, sampleRate) {
  const f = new Float32Array(pcm.length >> 1);
  for (let i = 0; i < f.length; i++) f[i] = pcm.readInt16LE(i * 2) / 32768;
  return floatToMulaw8k(f, sampleRate);
}

function floatToMulaw8k(mono, sampleRate) {
  const at8k = resampleLinear(mono, sampleRate, 8000);
  const pcm = Buffer.allocUnsafe(at8k.length * 2);
  for (let i = 0; i < at8k.length; i++) {
    const s = Math.max(-1, Math.min(1, at8k[i]));
    pcm.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), i * 2);
  }
  return pcm16ToMulaw(pcm);
}

/** WAV Buffer → 8 kHz mono µ-law Buffer, ready for Twilio Media Streams. */
export function wavToMulaw8k(buf) {
  const parsed = parseWav(buf);
  return floatToMulaw8k(readMonoFloat(parsed), parsed.fmt.sampleRate);
}
