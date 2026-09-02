// Fast, LLM-free classification of a caller interruption during playback.
// Decides whether to keep playing (backchannel / side talk) or stop and process.
// Adapted from the FreeSWITCH bot's lib/barge-classifier.js.

import { normalizeTranscript } from '../asr/hallucination-denylist.js';

const BACKCHANNEL = new Set([
  'yeah', 'yep', 'yup', 'uh huh', 'uh-huh', 'mhm', 'mm hm', 'mm-hmm', 'mmhmm',
  'okay', 'ok', 'right', 'sure', 'got it', 'i see', 'gotcha', 'alright',
  'go on', 'go ahead', 'continue', 'i am listening', "i'm listening",
]);

const SIDE_TALK = [
  /hold on/, /hang on/, /one (sec|second|moment)/, /just a (sec|minute|moment)/,
  /wait a (sec|minute|moment)/, /let me/, /(honey|babe|mom|dad|hey) [a-z]/,
];

const STOP_INTENT = [
  /not interested/, /take me off/, /remove me/, /stop calling/, /do not call/,
  /who is this/, /what (is )?this (is )?about/, /how did you get/, /are you a (bot|robot|machine|recording)/,
];

/**
 * @param {string} transcript  partial/short transcript of the interruption
 * @returns {'BACKCHANNEL'|'SIDE_TALK'|'STOP'} STOP = interrupt playback and process
 */
export function classifyBarge(transcript) {
  const n = normalizeTranscript(transcript);
  if (!n) return 'BACKCHANNEL';

  if (STOP_INTENT.some((re) => re.test(n))) return 'STOP';
  if (n.includes('?')) return 'STOP';
  if (BACKCHANNEL.has(n)) return 'BACKCHANNEL';
  if (SIDE_TALK.some((re) => re.test(n))) return 'SIDE_TALK';

  const words = n.split(' ').filter(Boolean);
  if (words.length <= 2) return 'BACKCHANNEL'; // short & not a known stop cue
  return 'STOP'; // a real sentence — the caller wants the floor
}
