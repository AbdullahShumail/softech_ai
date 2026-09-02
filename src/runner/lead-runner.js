import { config } from '../config.js';
import { logger } from '../obs/logger.js';
import {
  dueLeads,
  markDialing,
  setLeadStatus,
  leadCounts,
  withinCallingHours,
} from '../data/lead-repo.js';
import { bindCall, unbindCall } from './registry.js';
import { originate as twilioOriginate } from '../telephony/twilio-rest.js';

// Phase 1 dialer: one pass over the lead list, capped at MAX_CONCURRENT_CALLS,
// gated by per-lead calling hours. No predictive pacing, no automatic retries
// (a failed originate is re-queued once; everything else is marked done).
export class LeadRunner {
  constructor({
    originate = twilioOriginate,
    tickMs = 5000,
    hoursCheck = withinCallingHours,
    maxConcurrent = config.runner.maxConcurrent,
  } = {}) {
    this.originate = originate;
    this.tickMs = tickMs;
    this.hoursCheck = hoursCheck;
    this.maxConcurrent = maxConcurrent;
    this.inFlight = new Map(); // callSid -> leadId
    this.paused = true;
    this._timer = null;
  }

  start() {
    if (!this.paused) return;
    this.paused = false;
    logger.info({ maxConcurrent: this.maxConcurrent }, 'lead runner started');
    this._loop();
  }

  pause() {
    this.paused = true;
    clearTimeout(this._timer);
    logger.info('lead runner paused');
  }

  status() {
    return { paused: this.paused, inFlight: this.inFlight.size, leads: leadCounts() };
  }

  _loop() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._tick().finally(() => !this.paused && this._loop()), this.tickMs);
    this._timer.unref?.();
  }

  async _tick() {
    if (this.paused) return;
    const slots = this.maxConcurrent - this.inFlight.size;
    if (slots <= 0) return;

    const candidates = dueLeads(slots * 3);
    for (const lead of candidates) {
      if (this.inFlight.size >= this.maxConcurrent) break;
      if (!this.hoursCheck(lead.timezone, config.callingHours.start, config.callingHours.end)) {
        continue;
      }
      await this._dial(lead);
    }
  }

  async _dial(lead) {
    markDialing(lead.id);
    try {
      const callSid = await this.originate({ to: lead.phone, leadId: lead.id });
      this.inFlight.set(callSid, lead.id);
      bindCall(callSid, { leadId: lead.id, phone: lead.phone });
      logger.info({ callSid, leadId: lead.id }, 'dialing lead');
    } catch (err) {
      logger.error({ leadId: lead.id, err: err.message }, 'originate failed — requeued');
      setLeadStatus(lead.id, 'queued');
    }
  }

  /** Wire from /status on a terminal call state. */
  onCallComplete(callSid) {
    const leadId = this.inFlight.get(callSid);
    if (leadId == null) return;
    this.inFlight.delete(callSid);
    unbindCall(callSid);
    setLeadStatus(leadId, 'done'); // Phase 1: single pass
  }
}
