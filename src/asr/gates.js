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
  if (isFragment(raw)) return { ok: false, reason: 'fragment' };
  return { ok: true, text: raw };
}
