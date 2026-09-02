import OpenAI, { toFile } from 'openai';
import { config } from '../config.js';
import { mulawToPcm16 } from '../telephony/mulaw.js';
import { pcm16ToWav } from '../audio/wav.js';
import { logger } from '../obs/logger.js';

// Groq exposes an OpenAI-compatible audio.transcriptions endpoint.
const defaultClient = new OpenAI({
  apiKey: config.groq.apiKey,
  baseURL: config.groq.baseURL,
});

/**
 * Transcribe an 8 kHz µ-law buffer (as captured from Twilio) via Groq Whisper.
 * @param {Buffer} mulawBuf
 * @param {object} [opts]
 * @param {string} [opts.language='en']
 * @param {string} [opts.prompt]  biasing text (company name, product terms)
 * @param {OpenAI} [opts.client]  injectable for tests
 * @returns {Promise<{ text: string, ms: number }>}
 */
export async function transcribeMulaw(mulawBuf, opts = {}) {
  const { language = 'en', prompt, client = defaultClient } = opts;
  const wav = pcm16ToWav(mulawToPcm16(mulawBuf), 8000);
  const file = await toFile(wav, 'audio.wav', { type: 'audio/wav' });

  const t0 = Date.now();
  let text = '';
  try {
    const res = await client.audio.transcriptions.create({
      file,
      model: config.groq.sttModel,
      language,
      temperature: 0,
      ...(prompt ? { prompt } : {}),
    });
    text = (res.text || '').trim();
  } catch (err) {
    logger.error({ err: err.message }, 'stt failed');
    return { text: '', ms: Date.now() - t0, error: err.message };
  }

  const ms = Date.now() - t0;
  logger.debug({ ms, chars: text.length }, 'stt');
  return { text, ms };
}
