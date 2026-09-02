// callSid → { leadId, phone } binding, written by the lead runner when it
// originates a call and read by /voice to stamp the Media Stream with
// <Parameter> values. In-memory: a call that outlives a restart just loses its
// lead association (logged, not fatal).

const bindings = new Map();

export function bindCall(callSid, data) {
  bindings.set(callSid, data);
}

export function lookupCall(callSid) {
  return bindings.get(callSid) ?? null;
}

export function unbindCall(callSid) {
  bindings.delete(callSid);
}
