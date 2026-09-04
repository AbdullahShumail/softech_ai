// Deterministic classification for the utterances that make up most of a cold
// call. A hit here skips the LLM entirely — ~650 ms off the turn — and, for DNC,
// removes the classifier from a compliance-critical decision.
//
// This is a PRECISION filter, not a replacement for the classifier. Every rule
// has to be unambiguous on its own; anything with a plausible second reading
// returns null and falls through to classify(). It is always safe to add
// nothing here, and never safe to add a rule that is merely usually right.
//
// Rules are evaluated in listed order, which encodes the same priority the
// classifier prompt states: terminate > route > objection > question > advance.

import { normalizeTranscript } from '../asr/hallucination-denylist.js';

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const RULES = [
  // ---- terminate ----
  {
    d: 'DNC',
    res: [
      /\b(take|get|cross) (me|us) off\b/,
      /\bremove (me|us|my number)\b/,
      /\b(do ?n'?t|do not|never) (call|contact|phone)\b/,
      /\bstop calling\b/,
      /\bunsubscribe\b/,
      /\bdo not call (list|registry)\b/,
    ],
  },
  {
    d: 'ABUSE',
    res: [/\bfuck (off|you)\b/, /\bpiss off\b/, /\bgo to hell\b/, /\bshut the fuck up\b/],
  },
  {
    d: 'LB',
    res: [/\b(i )?(do ?n'?t|do not) speak english\b/, /\bno english\b/, /\bno hablo\b/],
  },

  // ---- route ----
  {
    d: 'NDM',
    dm: false,
    res: [
      /\b(i'?m |i am )?not the (owner|boss|one|person|decision)\b/,
      /\b(my|the) (boss|manager|partner|owner|husband|wife) (handles|does|deals|takes care)\b/,
      /\bsomeone else (handles|does|deals|takes care)\b/,
      /\byou'?d (need|have) to (speak|talk) to\b/,
      /\bthat'?s not (me|my department)\b/,
      /\bi just (work|answer)\b/,
    ],
  },
  {
    d: 'DM',
    dm: true,
    res: [
      /\b(i'?m|i am) the (owner|boss|manager|director|founder|ceo|proprietor)\b/,
      /\b(that'?s|this is) me\b/,
      /\bit'?s my (business|company|shop|store)\b/,
      /\bi (own|run) (it|the|this|my)\b/,
      /\byes,? (that'?s|it'?s) me\b/,
    ],
  },

  // Checked before the objections: "we don't have a website" is a strong lead,
  // not a brush-off, and it must never fall into HAS.
  {
    d: 'NOSITE',
    hints: { noSite: true },
    res: [
      /\b(do ?n'?t|do not|dont) have (a |any )?(web ?site|site|page)\b/,
      /\bno web ?site\b/,
      /\bnever had (a )?(web ?site|site)\b/,
      /\bwe'?re not online\b/,
      /\b(just|only) (a |have a )?(facebook|instagram)\b/,
    ],
  },

  // ---- objection ----
  {
    d: 'NI',
    res: [
      /\b(not|no'?t) interested\b/,
      /\b(do ?n'?t|do not|dont) need (it|that|this|any|one)\b/,
      /\bno thank(s| you)\b/,
      /\bwe'?re (all )?(good|fine|set|okay|ok)\b/,
      /\bnot for us\b/,
      /\bno need\b/,
    ],
  },
  {
    d: 'HAS',
    res: [
      // must name a person or vendor — a bare "we have a ..." is often "we have
      // a website", which is an answer, not an objection
      /\b(we|i) (already )?(have|got|use|work with) (a |an |our )?(guy|gal|developer|designer|agency|team|company|contractor|web ?master|it (guy|team)|someone|somebody)\b/,
      /\bin.?house\b/,
      /\balready (have|got|working with|have someone|sorted)\b/,
      /\bour (agency|developer|web ?guy|web ?master|it (guy|team|department))\b/,
      /\b(guy|agency|developer|team) (that |who )?(does|handles|takes care)\b/,
    ],
  },
  {
    d: 'HAP',
    res: [
      /\b(just|recently) (built|rebuilt|redid|redesigned|updated|launched|finished)\b/,
      /\bbrand.?new (site|web ?site)\b/,
      /\b(site|web ?site) is (fine|good|great|new|modern)\b/,
      /\bhappy with (it|our|the|my)\b/,
      /\bno changes needed\b/,
      /\b(site|web ?site) (was )?(done|made) (last|this) year\b/,
    ],
  },
  {
    d: 'BUDGET',
    res: [
      /\btoo expensive\b/,
      /\bno budget\b/,
      /\bcan'?t afford\b/,
      /\bnot (in the |in )?budget\b/,
      /\b(do ?n'?t|do not) have (the )?money\b/,
      /\bcosts too much\b/,
    ],
  },
  {
    d: 'SMALL',
    res: [
      /\bword of mouth\b/,
      /\b(we'?re|i'?m|it'?s) (just |only )?(a )?(very |really |too )?small\b/,
      /\b(do ?n'?t|do not) sell online\b/,
      /\b(too|very) small (a )?(business|shop|company|operation)\b/,
      /\bwe'?re a one.?man\b/,
    ],
  },
  {
    d: 'THINK',
    res: [
      /\b(let me|i'?ll|i will|need to) think\b/,
      /\bthink (about|it over)\b/,
      /\b(talk|speak|check) (to|with) my (partner|wife|husband|boss|team)\b/,
      /\bget back to you\b/,
      /\bmaybe (later|another time|down the (road|line))\b/,
    ],
  },

  // ---- callback ----
  {
    d: 'CB',
    res: [
      /\bcall (me |us )?back\b/,
      /\bcall (me|us) (later|tomorrow|next week|another time)\b/,
      /\btry (me |us )?(again |back )?(later|tomorrow|next week)\b/,
    ],
  },
  {
    d: 'TIME',
    res: [
      /\bi'?m (busy|driving|in a meeting|with a customer)\b/,
      /\b(bad|not a good|not the best) time\b/,
      /\bnot (right )?now\b/,
      /\bin the middle of\b/,
      /\bwith a (customer|client|patient)\b/,
    ],
  },

  // ---- question ----
  {
    d: 'BOT',
    res: [
      /\b(are|is) (you|this) (a |an )?(bot|robot|ai|recording|machine|computer|automated)\b/,
      /\bam i (talking|speaking) to (a )?(robot|machine|computer|bot|real person|human)\b/,
      /\bare you (a )?(real )?(person|human)\b/,
      /\bis this (a )?(recorded|recording)\b/,
    ],
  },
  {
    d: 'WHO',
    res: [
      /\bwho('| i)?s (this|calling|speaking)\b/,
      /\bwho am i (speaking|talking) (to|with)\b/,
      /\bwho is this\b/,
      /\bwhat company\b/,
      /\bwhere are you calling from\b/,
    ],
  },
  {
    d: 'HOW',
    res: [
      /\bhow did you get (my|this|our)\b/,
      /\bwhere did you get (my|this|our)\b/,
      /\bwhat('| i)?s this (about|regarding|in reference)\b/,
      /\bwhat do you (do|want|guys do)\b/,
    ],
  },
  {
    d: 'PRICE',
    res: [
      /\bhow much (does|would|do|is|will|are)\b/,
      /\bwhat('| i)?s (the|your) (price|cost|rate|pricing)\b/,
      /\bwhat would (it|that) cost\b/,
      /\bball ?park\b/,
    ],
  },
  {
    d: 'PROOF',
    res: [
      /\bis this (a )?(scam|legit|legitimate|real)\b/,
      /\bwho have you worked (with|for)\b/,
      /\bany (references|examples|case studies)\b/,
      /\bdo you have a (web ?site|portfolio)\b/,
      /\bsounds like a scam\b/,
    ],
  },
  {
    d: 'EMAIL',
    res: [
      /\b(send|email) (me|us|it|that|something|info|details)\b/,
      /\bsend (me |us )?an email\b/,
      /\bput (it|that) in (an )?email\b/,
      /\bby email\b/,
    ],
  },

  // ---- advance ----
  {
    d: 'INT',
    res: [
      /\b(sounds|that sounds) (good|great|interesting|useful)\b/,
      /\btell me more\b/,
      /\bi'?m interested\b/,
      /\bwhat('| i)?s involved\b/,
      /\bgo ahead,? (i'?m )?(listening|interested)\b/,
      /\byes,? (please|i'?d like|i would)\b/,
    ],
  },
  {
    d: 'WAIT',
    res: [/\b(hold|hang) on\b/, /\bone (sec|second|moment|minute)\b/, /\bjust a (sec|second|moment|minute)\b/],
  },
];

/** Pull a website age in years out of an answer to the opening question. */
function extractSiteAge(n) {
  let m = n.match(/\b(\d{1,2})\s*(?:year|yr)s?\b/);
  if (m) return Number(m[1]);

  m = n.match(/\b([a-z]+)\s+(?:year|yr)s?\b/);
  if (m && WORD_NUMBERS[m[1]] != null) return WORD_NUMBERS[m[1]];

  m = n.match(/\b(\d{1,3})\s*months?\b/);
  if (m) return Number(m[1]) / 12;

  m = n.match(/\b([a-z]+)\s+months?\b/);
  if (m && WORD_NUMBERS[m[1]] != null) return WORD_NUMBERS[m[1]] / 12;

  m = n.match(/\b(?:since|from|back in|in)\s+((?:19|20)\d{2})\b/) || n.match(/\b((?:19|20)\d{2})\b/);
  if (m) {
    const age = new Date().getFullYear() - Number(m[1]);
    if (age >= 0 && age < 40) return age;
  }
  return null;
}

// Vague answers that still mean "old enough to matter".
const VAGUE_OLD = /\b(a while|ages|long time|years ago|forever|no idea|do ?n'?t know|can'?t remember|original)\b/;

/**
 * Classify an utterance without calling the LLM.
 *
 * @param {string} text     screened transcript
 * @param {object} [ctx]    { awaitingDecisionMaker?: boolean, pitchDelivered?: boolean }
 * @returns {null | {disposition:string, decisionMaker:(boolean|null), hints:object, thought:string}}
 *          null means "not confident — ask the classifier"
 */
export function fastPath(text, ctx = {}) {
  const n = normalizeTranscript(text);
  if (!n) return null;

  // A bare yes/no is meaningless in isolation but decisive right after we asked
  // who makes the call, so it only resolves here when that question is open.
  if (ctx.awaitingDecisionMaker) {
    if (/^(yes|yeah|yep|yup|correct|i am|that'?s right|sure)\.?$/.test(n)) {
      return hit('DM', true, {}, 'confirmed decision maker');
    }
    if (/^(no|nope|nah|not me)\.?$/.test(n)) {
      return hit('NDM', false, {}, 'declined decision maker');
    }
  }

  for (const rule of RULES) {
    if (rule.res.some((re) => re.test(n))) {
      return hit(rule.d, rule.dm ?? null, rule.hints ?? {}, `fast-path ${rule.d}`);
    }
  }

  // Answering the opening question with an age is the single most common turn 1
  // reply, and it carries the hint that picks which pitch we open with.
  if (!ctx.pitchDelivered) {
    const years = extractSiteAge(n);
    if (years != null) {
      return hit('NEU', null, { siteAgeYears: years }, `site age ~${Math.round(years)}y`);
    }
    if (VAGUE_OLD.test(n)) {
      return hit('NEU', null, { siteAgeYears: 99 }, 'site vaguely old');
    }
  }

  return null; // fall through to the LLM
}

function hit(disposition, decisionMaker, hints, thought) {
  return { disposition, decisionMaker, hints, thought };
}
