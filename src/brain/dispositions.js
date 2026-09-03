// Disposition codes the classifier can emit for one caller utterance.
// `group` drives the logic engine; keep codes stable — they're logged and
// mapped to audio and to CRM outcomes.

export const DISPOSITIONS = {
  INT: { desc: "Positive interest — \"tell me more\", \"sounds good\", asks what it would cost or how long it takes", group: 'advance' },
  NEU: { desc: "Neutral, or simply ANSWERS the website-age question — \"5 years\", \"since 2019\", \"a while back\", \"we don't have one\", \"no website\", \"go on\", \"okay\"", group: 'advance' },
  DM: { desc: 'States or confirms they own the business or decide on web/software', group: 'advance' },
  NDM: { desc: 'Not the decision maker; someone else handles this', group: 'route' },
  QUAL: { desc: 'Decision maker AND clearly interested — ready for a consultant', group: 'transfer' },

  NI: { desc: "Brush-off with no specific reason — \"not interested\", \"I don't need it\", \"no thanks\", \"we're fine\"", group: 'objection' },
  HAS: { desc: "Already has someone — \"we have a guy\", \"our agency handles it\", \"in-house team\", \"already working with someone\"", group: 'objection' },
  HAP: { desc: "Happy as-is — \"our site is fine\", \"we just rebuilt it\", \"brand new site\", \"no changes needed\"", group: 'objection' },
  BUDGET: { desc: "Cost objection — \"too expensive\", \"no budget\", \"can't afford it\", \"how much\" said dismissively", group: 'objection' },

  TIME: { desc: "Bad moment — \"not now\", \"I'm busy\", \"I'm driving\", \"in a meeting\"", group: 'callback' },
  CB: { desc: 'Explicit request to be called back another time', group: 'callback' },

  BOT: { desc: 'Asks if this is a bot, AI, or a recording', group: 'question' },
  WHO: { desc: "Asks who is calling — \"who is this\", \"what company\", \"who am I speaking to\", \"where are you calling from\"", group: 'question' },
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
