// Energy-based speech endpointer for inbound telephony audio.
//
// Dependency-free (no native VAD module). Per 20 ms frame it computes RMS,
// adapts a noise floor while the line is idle, and declares speech-start after
// a few voiced frames / speech-end after a run of trailing silence. This is the
// same approach the FreeSWITCH bot used in production; it holds up at 8 kHz on
// PSTN-quality audio. Silero can slot in later behind the same interface.

function rms(pcm16) {
  if (pcm16.length < 2) return 0;
  let sum = 0;
  const n = pcm16.length >> 1;
  for (let i = 0; i < n; i++) {
    const s = pcm16.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

export class Endpointer {
  constructor(opts = {}) {
    this.frameMs = opts.frameMs ?? 20;
    this.noiseFloor = opts.initialNoiseFloor ?? 200;
    this.noiseAlpha = opts.noiseAlpha ?? 0.98; // slow adaptation while idle
    this.speechRatio = opts.speechRatio ?? 3.0;
    this.minSpeechRms = opts.minSpeechRms ?? 250;
    this.startFrames = opts.startFrames ?? 3; // ~60 ms to trigger
    this.endFrames = opts.endFrames ?? 35; // ~700 ms trailing silence to end
    this.maxUtteranceMs = opts.maxUtteranceMs ?? 15000;

    this.inSpeech = false;
    this._voiced = 0;
    this._silent = 0;
    this._utteranceMs = 0;
    this.lastRms = 0;
  }

  get threshold() {
    return Math.max(this.minSpeechRms, this.noiseFloor * this.speechRatio);
  }

  /**
   * Feed one frame of mono PCM16LE (≈20 ms / 160 samples at 8 kHz).
   * @returns {null | {type:'speech-start'} | {type:'speech-end', reason:'silence'|'max-duration'}}
   */
  push(pcm16) {
    const level = rms(pcm16);
    this.lastRms = level;
    const voiced = level > this.threshold;

    if (!this.inSpeech) {
      // Adapt the noise floor only when we're not in an utterance.
      this.noiseFloor = this.noiseAlpha * this.noiseFloor + (1 - this.noiseAlpha) * level;
      if (voiced) {
        if (++this._voiced >= this.startFrames) {
          this.inSpeech = true;
          this._voiced = 0;
          this._silent = 0;
          this._utteranceMs = 0;
          return { type: 'speech-start' };
        }
      } else {
        this._voiced = 0;
      }
      return null;
    }

    this._utteranceMs += this.frameMs;
    if (voiced) {
      this._silent = 0;
    } else if (++this._silent >= this.endFrames) {
      this.inSpeech = false;
      this._silent = 0;
      return { type: 'speech-end', reason: 'silence' };
    }

    if (this._utteranceMs >= this.maxUtteranceMs) {
      this.inSpeech = false;
      this._silent = 0;
      return { type: 'speech-end', reason: 'max-duration' };
    }
    return null;
  }

  reset() {
    this.inSpeech = false;
    this._voiced = 0;
    this._silent = 0;
    this._utteranceMs = 0;
  }
}
