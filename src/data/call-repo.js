import { db } from './db.js';

const _insertCall = db.prepare(
  `INSERT INTO calls (call_sid, lead_id) VALUES (?, ?)
   ON CONFLICT(call_sid) DO NOTHING`,
);
const _callId = db.prepare(`SELECT id FROM calls WHERE call_sid = ?`);
const _insertTurn = db.prepare(
  `INSERT INTO call_turns (call_id, turn, transcript, disposition, thought, latency_ms)
   VALUES (@call_id, @turn, @transcript, @disposition, @thought, @latency_ms)`,
);
const _finalize = db.prepare(
  `UPDATE calls SET
     ended_at = datetime('now'),
     answered = @answered,
     final_disposition = @final_disposition,
     pitch_delivered = @pitch_delivered,
     transferred = @transferred,
     duration_s = @duration_s
   WHERE call_sid = @call_sid`,
);
const _addDnc = db.prepare(
  `INSERT INTO dnc (phone, source) VALUES (?, 'call') ON CONFLICT(phone) DO NOTHING`,
);
const _isDnc = db.prepare(`SELECT 1 FROM dnc WHERE phone = ?`);

export function startCall(callSid, leadId = null) {
  _insertCall.run(callSid, leadId);
  return _callId.get(callSid)?.id ?? null;
}

export function recordTurn(callId, t) {
  if (callId == null) return;
  _insertTurn.run({
    call_id: callId,
    turn: t.turn,
    transcript: t.transcript ?? null,
    disposition: t.disposition ?? null,
    thought: t.thought ?? null,
    latency_ms: t.latencyMs ?? null,
  });
}

export function finalizeCall(callSid, f = {}) {
  _finalize.run({
    call_sid: callSid,
    answered: f.answered ? 1 : 0,
    final_disposition: f.finalDisposition ?? null,
    pitch_delivered: f.pitchDelivered ? 1 : 0,
    transferred: f.transferred ? 1 : 0,
    duration_s: f.durationS ?? null,
  });
}

export function markDnc(phone) {
  if (phone) _addDnc.run(phone);
}

export function isDnc(phone) {
  return phone ? !!_isDnc.get(phone) : false;
}
