import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// One JSON file per call: full transcript, turns, events, timings. This is the
// primary record for `log-viewer.html` — no external stack.

export class CallLog {
  constructor(dir, callSid) {
    this.enabled = true;
    try {
      mkdirSync(dir, { recursive: true });
      this.path = join(dir, `${callSid}.json`);
    } catch {
      this.enabled = false;
    }
    this.data = {
      callSid,
      startedAt: new Date().toISOString(),
      events: [],
      turns: [],
    };
    this._flush();
  }

  event(type, detail = {}) {
    this.data.events.push({ ts: Date.now(), type, ...detail });
    this._flush();
  }

  turn(rec) {
    this.data.turns.push({ ts: Date.now(), ...rec });
    this._flush();
  }

  finalize(summary = {}) {
    this.data.endedAt = new Date().toISOString();
    Object.assign(this.data, summary);
    this._flush();
  }

  _flush() {
    if (!this.enabled) return;
    try {
      writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    } catch {
      /* best effort */
    }
  }
}
