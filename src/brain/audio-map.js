// Disposition / call-state → prompt file name(s). Names are filenames (no .wav)
// under prompts/<campaign>/. Keep this the single source of truth for which
// audio the bot can play.
//
// Long turns are ARRAYS of sentence-sized clips, not one big WAV. Two reasons:
// the caller gets natural places to jump in, and because playback drops a mark
// per clip we know how far we actually got — so a backchannel ("mm-hm") resumes
// at the next clip instead of restarting a 35-second pitch from the top.

export const PROMPTS = {
  // Answering a call and being spoken at instantly reads as a robocall. A beat of
  // silence, then a human opener, then the identification.
  hello: 'hello',
  greeting: 'greeting',
  pitch: ['pitch-1', 'pitch-2', 'pitch-3'],
  // Same pitch, but opening on the fact that they just told us the site is old.
  pitchDated: ['pitch-dated', 'pitch-2', 'pitch-3'],
  pitchNoSite: 'pitch-nosite',
  // Honours "I'll be thirty seconds" after a TIME objection — opener + payoff only.
  pitchShort: ['pitch-1', 'pitch-3'],
  // Warm beat between their answer and the pitch, so the bot acknowledges what
  // they said instead of steamrolling into the sales copy.
  great: 'great',
  pitchFollowup: 'pitch-followup',
  askDecisionMaker: 'ask-decision-maker',
  transfer: 'transfer',
  // Played instead of `transfer` when there is no closer to bridge to: the lead
  // is captured for follow-up rather than promised a hand-off we cannot do.
  qualifiedCapture: 'close-qualified',
  reprompt: 'reprompt',
  waitAck: 'wait-ack',
  voicemail: 'voicemail-message',
};

// Short "I heard you" tokens played while the classifier is still thinking, so
// the caller gets a response at ~450 ms instead of sitting in silence for ~1.5 s.
export const ACK_PROMPTS = ['ack-1', 'ack-2', 'ack-3', 'ack-4', 'ack-5', 'ack-6'];

// Rebuttal LADDERS, not single lines. Rung 0 acknowledges and reframes, rung 1
// gives a concrete hook, rung 2 shrinks the ask to almost nothing. Running off
// the end returns null, which the logic engine reads as "out of road — close".
// Nothing outs a bot faster than hearing the identical sentence twice.
const REBUTTAL = {
  NI: ['reb-ni-1', 'reb-ni-2', 'reb-ni-3'],
  HAS: ['reb-has-1', 'reb-has-2', 'reb-has-3'],
  HAP: ['reb-hap-1', 'reb-hap-2', 'reb-hap-3'],
  BUDGET: ['reb-budget-1', 'reb-budget-2', 'reb-budget-3'],
  SMALL: ['reb-small-1', 'reb-small-2'],
  THINK: ['reb-think-1'],
  TIME: ['reb-time-1'],
};

const ANSWER = {
  BOT: 'ans-bot',
  WHO: 'ans-who',
  HOW: 'ans-how',
  EMAIL: 'ans-email',
  PRICE: 'ans-price',
  PROOF: 'ans-proof',
};

const CLOSE = {
  NI: 'close-not-interested',
  HAS: 'close-not-interested',
  HAP: 'close-not-interested',
  BUDGET: 'close-not-interested',
  SMALL: 'close-not-interested',
  THINK: 'close-callback',
  CB: 'close-callback',
  TIME: 'close-callback',
  DNC: 'close-dnc',
  ABUSE: 'close-generic',
  LB: 'close-language',
  NDM: 'ndm-close',
  R: 'close-generic',
  _default: 'close-generic',
};

/**
 * @param {string} code  disposition
 * @param {number} rung  how many rebuttals this code has already used
 * @returns {string|null} null once the ladder is exhausted — never repeats
 */
export const rebuttalPrompt = (code, rung = 0) => REBUTTAL[code]?.[rung] ?? null;

/** How many rungs a code's ladder has (0 if it has none). */
export const rebuttalDepth = (code) => REBUTTAL[code]?.length ?? 0;

export const answerPrompt = (code) => ANSWER[code] ?? null;
export const closePrompt = (code) => CLOSE[code] ?? CLOSE._default;

/** Every prompt name this map can ever ask for — used to validate the library at boot. */
export function allPromptNames() {
  const names = [
    ...Object.values(PROMPTS),
    ...ACK_PROMPTS,
    ...Object.values(REBUTTAL),
    ...Object.values(ANSWER),
    ...Object.values(CLOSE),
  ]
    .flat()
    .filter(Boolean);
  return [...new Set(names)];
}
