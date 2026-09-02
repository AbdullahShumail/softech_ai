// Disposition / call-state → prompt file name(s). Names are filenames (no .wav)
// under prompts/<campaign>/. Keep this the single source of truth for which
// audio the bot can play.

export const PROMPTS = {
  greeting: 'greeting',
  pitch: 'pitch',
  pitchFollowup: 'pitch-followup',
  askDecisionMaker: 'ask-decision-maker',
  transfer: 'transfer',
  reprompt: 'reprompt',
  waitAck: 'wait-ack',
  voicemail: 'voicemail-message',
};

const REBUTTAL = {
  NI: 'reb-ni',
  HAS: 'reb-has',
  HAP: 'reb-hap',
  BUDGET: 'reb-budget',
};

const ANSWER = {
  BOT: 'ans-bot',
  WHO: 'ans-who',
  HOW: 'ans-how',
  EMAIL: 'ans-email',
};

const CLOSE = {
  NI: 'close-not-interested',
  HAS: 'close-not-interested',
  HAP: 'close-not-interested',
  BUDGET: 'close-not-interested',
  CB: 'close-callback',
  TIME: 'close-callback',
  DNC: 'close-dnc',
  ABUSE: 'close-generic',
  LB: 'close-language',
  NDM: 'ndm-close',
  R: 'close-generic',
  _default: 'close-generic',
};

export const rebuttalPrompt = (code) => REBUTTAL[code] ?? null;
export const answerPrompt = (code) => ANSWER[code] ?? null;
export const closePrompt = (code) => CLOSE[code] ?? CLOSE._default;

/** Every prompt name this map can ever ask for — used to validate the library at boot. */
export function allPromptNames() {
  return [
    ...Object.values(PROMPTS),
    ...Object.values(REBUTTAL),
    ...Object.values(ANSWER),
    ...Object.values(CLOSE).filter((v, i, a) => a.indexOf(v) === i && v !== CLOSE._default),
    CLOSE._default,
  ].filter((v, i, a) => a.indexOf(v) === i);
}
