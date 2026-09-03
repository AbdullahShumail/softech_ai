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
    this.minSpeechRms = opts.minSpeechRms ?? 450;
    this.startFrames = opts.startFrames ?? 6; // ~120 ms to trigger
    this.endFrames = opts.endFrames ?? 35; // ~700 ms trailing silence to end
    this.maxUtteranceMs = opts.maxUtteranceMs ?? 15000;

    // Strict mode is used while the BOT is talking. Without it the bot's own
    // audio — echoed back through a speakerphone or a laptop mic — trips the
    // endpointer and gets transcribed as if the caller said it.
    this.strictStartFrames = opts.strictStartFrames ?? 18; // ~360 ms of real speech
    this.strictRmsMultiplier = opts.strictRmsMultiplier ?? 2.2;
    this.strict = false;

    this.inSpeech = false;
    this._voiced = 0;
    this._silent = 0;
    this._utteranceMs = 0;
    this.lastRms = 0;
  }

  /** Strict while the bot speaks (echo rejection), relaxed while listening. */
  setStrict(on) {
    this.strict = !!on;
    this._voiced = 0;
  }

  get threshold() {
    const base = Math.max(this.minSpeechRms, this.noiseFloor * this.speechRatio);
    return this.strict ? base * this.strictRmsMultiplier : base;
  }

  get requiredStartFrames() {
    return this.strict ? this.strictStartFrames : this.startFrames;
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
      // Track the noise floor from QUIET frames only. Adapting on loud frames too
      // lets a long voiced run inflate the floor past its own threshold, so the
      // voiced counter resets and speech-start never fires — which bites hardest
      // in strict mode, where we wait for many more frames before triggering.
      if (!voiced) {
        this.noiseFloor = this.noiseAlpha * this.noiseFloor + (1 - this.noiseAlpha) * level;
      }
      if (voiced) {
        if (++this._voiced >= this.requiredStartFrames) {
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
