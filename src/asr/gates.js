import { isHallucinationPhrase, normalizeTranscript } from './hallucination-denylist.js';

// Cheap text screens between STT and the classifier. Each returns a reason to
// DROP the utterance, or null to let it through.

const VOICEMAIL_PATTERNS = [
  /leave a (message|voicemail)/i,
  /after the (tone|beep)/i,
  /at the (tone|beep)/i,
  /(record your message|please record)/i,
  /not available (right now|to take your call)/i,
  /you('| ha)ve reached the voicemail/i,
  /the (person|number) you (are|have) (trying to reach|dialed)/i,
  /press (1|one) to (leave|send)/i,
  /your call has been forwarded/i,
];

// Short answers we must NOT treat as fragments — they're meaningful in context.
const SHORT_ANSWER_WHITELIST = new Set([
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'correct', 'right',
  'no', 'nope', 'nah', 'not now', 'never',
  'stop', 'remove me', 'take me off', 'do not call', "don't call",
  'who', 'what', 'why', 'how', 'hello', 'goodbye',
]);

/**
 * Whisper loops when it runs out of real audio: a live call produced
 * "and I'm going to be able to get a ticket to the ticket to the ticket".
 * Fluent, confident, and entirely invented — a denylist can never catch these.
 *
 * The giveaway is that the loop RUNS TO THE END of the utterance. That matters,
 * because it separates a stuck decoder from a person genuinely repeating
 * themselves: "I'm not interested, I'm not interested, please stop calling"
 * repeats too, but then carries on and says something new.
 */
export function isRepetitionLoop(text) {
  const words = normalizeTranscript(text).split(' ').filter(Boolean);
  if (words.length < 8) return false;

  // three or more identical words in a row
  let run = 1;
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run >= 3) return true;
  }

  // the tail is a phrase repeating itself right up to the final word
  for (let n = 2; n <= 6; n++) {
    if (words.length < 2 * n) break;
    const a = words.slice(-2 * n, -n).join(' ');
    const b = words.slice(-n).join(' ');
    if (a === b) return true;
  }

  // almost no distinct vocabulary across a long utterance
  const distinct = new Set(words).size;
  return words.length >= 10 && distinct / words.length <= 0.34;
}

export function isVoicemail(text) {
  return VOICEMAIL_PATTERNS.some((re) => re.test(text));
}

/**
 * A too-short utterance that isn't a recognized short answer and isn't a number
 * (ages, quantities, "20 employees") and isn't a question.
 */
export function isFragment(text) {
  const n = normalizeTranscript(text);
  if (!n) return true;
  if (SHORT_ANSWER_WHITELIST.has(n)) return false;
  if (/\d/.test(n)) return false; // keep anything with a number
  if (n.includes('?')) return false;
  const words = n.split(' ').filter(Boolean);
  return words.length < 2 || n.length < 3;
}

/**
 * Single entry point. Returns { ok, reason }.
 *   reason ∈ 'empty' | 'hallucination' | 'voicemail' | 'fragment'
 */
export function screenTranscript(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  if (isVoicemail(raw)) return { ok: false, reason: 'voicemail' };
  if (isHallucinationPhrase(raw)) return { ok: false, reason: 'hallucination' };
  if (isRepetitionLoop(raw)) return { ok: false, reason: 'repetition' };
  if (isFragment(raw)) return { ok: false, reason: 'fragment' };
  return { ok: true, text: raw };
}
