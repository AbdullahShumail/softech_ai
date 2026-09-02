// Disposition codes the classifier can emit for one caller utterance.
// `group` drives the logic engine; keep codes stable — they're logged and
// mapped to audio and to CRM outcomes.

export const DISPOSITIONS = {
  INT: { desc: 'Positive interest — wants to hear more, or engages with the pitch', group: 'advance' },
  NEU: { desc: 'Neutral / non-committal — "what is this about", "go on", "okay"', group: 'advance' },
  DM: { desc: 'States or confirms they own the business or decide on web/software', group: 'advance' },
  NDM: { desc: 'Not the decision maker; someone else handles this', group: 'route' },
  QUAL: { desc: 'Decision maker AND clearly interested — ready for a consultant', group: 'transfer' },

  NI: { desc: 'Soft "not interested", no specific reason given', group: 'objection' },
  HAS: { desc: 'Already has a developer, agency, or in-house team', group: 'objection' },
  HAP: { desc: 'Happy with their current website / software as it is', group: 'objection' },
  BUDGET: { desc: 'Cost / budget / "too expensive" objection', group: 'objection' },

  TIME: { desc: 'Busy right now / "bad time"', group: 'callback' },
  CB: { desc: 'Explicit request to be called back another time', group: 'callback' },

  BOT: { desc: 'Asks if this is a bot, AI, or a recording', group: 'question' },
  WHO: { desc: 'Asks who is calling / what company', group: 'question' },
  HOW: { desc: 'Asks how it works, how we got their number, what exactly we do', group: 'question' },
  EMAIL: { desc: 'Asks to receive information by email instead', group: 'question' },

  DNC: { desc: 'Do not call / remove me / stop calling', group: 'terminate' },
  ABUSE: { desc: 'Hostile, profane, or threatening', group: 'terminate' },
  LB: { desc: 'Language barrier — cannot communicate in English', group: 'terminate' },
  AM: { desc: 'Answering machine or voicemail system', group: 'terminate' },

  WAIT: { desc: 'Asks to hold on / side conversation / "one moment"', group: 'hold' },
  R: { desc: 'Unclear, garbled, silence, or no meaningful response', group: 'reprompt' },
};

export const DISPOSITION_CODES = Object.keys(DISPOSITIONS);
