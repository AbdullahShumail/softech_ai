// Outbound prompt playback over Twilio Media Streams.
//
// Twilio buffers outbound `media` and plays it at 8 kHz no matter how fast we
// send, and `clear` flushes that buffer instantly — so, unlike the FreeSWITCH
// path, no real-time frame pacer is needed. Per prompt sequence we send the
// µ-law in modest chunks, drop a `mark` after the last one, and resolve the play
// promise when that mark echoes back. A newer play() or a barge-in supersedes
// the current one: flush Twilio's buffer and bump the generation so a late mark
// for the abandoned play is ignored.

const CHUNK_BYTES = 4000; // ~0.5 s of 8 kHz µ-law per media message

export class Playback {
  constructor(session, library) {
    this.session = session;
    this.library = library;
    this.gen = 0;
    this.pending = null; // { gen, resolve, finalMark, played }
  }

  get isPlaying() {
    return this.pending != null;
  }

  /**
   * Play prompt names in order.
   * @param {string|string[]} names
   * @returns {Promise<{completed: boolean, played: string[]}>}
   *   completed:false — a barge-in or a newer play() superseded this one.
   */
  play(names) {
    this._abort(); // supersede + flush anything in flight
    const gen = ++this.gen;

    const list = (Array.isArray(names) ? names : [names]).filter((n) => {
      if (this.library.has(n)) return true;
      this.session.log?.warn({ prompt: n }, 'prompt missing, skipping');
      return false;
    });
    if (list.length === 0) return Promise.resolve({ completed: true, played: [] });

    for (const name of list) {
      const mu = this.library.get(name);
      for (let o = 0; o < mu.length; o += CHUNK_BYTES) {
        this.session.sendAudio(mu.subarray(o, o + CHUNK_BYTES));
      }
      this.session.sendMark(`seg:${gen}:${name}`);
    }

    const finalMark = `done:${gen}`;
    this.session.sendMark(finalMark);

    return new Promise((resolve) => {
      this.pending = { gen, resolve, finalMark, played: list };
    });
  }

  /** Feed a mark name echoed back by Twilio (wire from session.onMark). */
  onMark(name) {
    const p = this.pending;
    if (p && p.gen === this.gen && name === p.finalMark) {
      this.pending = null;
      p.resolve({ completed: true, played: p.played });
    }
  }

  /** Barge-in / new turn: flush Twilio's buffer and abandon the current play. */
  interrupt() {
    if (this.pending) {
      this._abort();
      this.gen++; // ignore any late marks for the abandoned generation
    }
  }

  _abort() {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    this.session.clear();
    p.resolve({ completed: false, played: p.played });
  }
}
