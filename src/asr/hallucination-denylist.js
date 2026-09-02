// Phrases Whisper commonly emits from silence, hold music, line noise, or
// tone bleed. If a transcript is *only* one of these (after normalization),
// it's treated as noise, not speech. Tune from real call logs.

export const HALLUCINATION_PHRASES = [
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching!',
  'thank you for watching',
  'please subscribe',
  'like and subscribe',
  'you',
  'bye',
  'bye.',
  'bye bye',
  'okay',
  '.',
  '. .',
  '...',
  'the',
  'so',
  'i',
  'hmm',
  'mm',
  'mm-hmm',
  'uh',
  'um',
  'subtitles by the amara.org community',
  'transcription by castingwords',
  'www.mooji.org',
  'peace',
  'silence',
  '[silence]',
  '[music]',
  '[ music ]',
  'music playing',
  'music',
];

const SET = new Set(HALLUCINATION_PHRASES.map((p) => p.toLowerCase()));

/** Normalize for comparison: lowercase, strip surrounding punctuation/space, collapse spaces. */
export function normalizeTranscript(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\-.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isHallucinationPhrase(text) {
  const n = normalizeTranscript(text);
  if (!n) return true;
  if (SET.has(n)) return true;
  // strip trailing period and retry
  if (n.endsWith('.') && SET.has(n.slice(0, -1).trim())) return true;
  return false;
}
