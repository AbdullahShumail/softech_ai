import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../obs/logger.js';

// The words behind each prompt name. The bot plays WAVs, so nothing downstream
// of playback knows what was actually said — logs and the call viewer would show
// "played reb-ni-2" and leave you guessing. This reads the same script the audio
// was generated from so a transcript can show both sides of the conversation.
//
// Read once at import. If the script is missing the bot still runs; the viewer
// just falls back to prompt names.

const here = dirname(fileURLToPath(import.meta.url));

let SCRIPT = {};
try {
  SCRIPT = JSON.parse(readFileSync(join(here, '../../tools/prompt-script.json'), 'utf8'));
} catch (err) {
  logger.warn({ err: err.message }, 'prompt script not readable — transcripts will show prompt names');
}

/** The line behind one prompt name, or '' if unknown. */
export function promptText(name) {
  const t = SCRIPT[name];
  return typeof t === 'string' ? t : '';
}

/**
 * Join a play list into the single utterance the caller actually heard.
 * The pitch is three clips; to a listener it is one sentence.
 */
export function spokenText(names = []) {
  return names
    .map((n) => promptText(n))
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** Shorten for a one-line console log. */
export function ellipsis(text, max = 90) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1) + '…';
}
