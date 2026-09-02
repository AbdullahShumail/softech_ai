// Cheap in-memory counters — replaces the Prometheus stack for this scale.
const startedAt = Date.now();

export const counters = {
  callsStarted: 0,
  callsAnswered: 0,
  callsCompleted: 0,
  transfers: 0,
  activeCalls: 0,
  streamErrors: 0,
};

export function healthSnapshot() {
  return {
    ok: true,
    uptimeS: Math.round((Date.now() - startedAt) / 1000),
    ...counters,
  };
}
