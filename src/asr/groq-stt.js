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
 * Whisper invents fluent text from silence, line noise and hold music — live
 * calls produced "Love", "Peppol", "Thank you." and a repetition loop
 * ("a ticket to the ticket to the ticket"). A denylist only catches phrases we
 * have already seen, but the model reports its own confidence per segment, so
 * ask for it and throw away what it does not believe.
 *
 * no_speech_prob: how sure the model is the audio contains no speech at all.
 * avg_logprob:    mean token confidence. Invented text scores far lower than
 *                 a real utterance, even when it reads fluently.
 */
function judge(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  let dur = 0;
  let noSpeech = 0;
  let logprob = 0;
  for (const s of segments) {
    const d = Math.max(0.01, (s.end ?? 0) - (s.start ?? 0));
    dur += d;
    noSpeech += (s.no_speech_prob ?? 0) * d;
    logprob += (s.avg_logprob ?? 0) * d;
  }
  if (dur <= 0) return null;
  return { noSpeechProb: noSpeech / dur, avgLogprob: logprob / dur };
}

/**
 * Transcribe an 8 kHz µ-law buffer (as captured from Twilio) via Groq Whisper.
 * @param {Buffer} mulawBuf
 * @param {object} [opts]
 * @param {string} [opts.language='en']
 * @param {string} [opts.prompt]  biasing text — see session.sttPrompt. This
 *   steers the decoder, so it must describe what the CALLER says, never our own
 *   script, or the bot's echo gets decoded into our own words.
 * @param {OpenAI} [opts.client]  injectable for tests
 * @returns {Promise<{ text: string, ms: number, dropped?: string, confidence?: object }>}
 */
export async function transcribeMulaw(mulawBuf, opts = {}) {
  const { language = 'en', prompt, client = defaultClient } = opts;
  const wav = pcm16ToWav(mulawToPcm16(mulawBuf), 8000);
  const file = await toFile(wav, 'audio.wav', { type: 'audio/wav' });

  const t0 = Date.now();
  let res;
  try {
    res = await client.audio.transcriptions.create({
      file,
      model: config.groq.sttModel,
      language,
      temperature: 0,
      response_format: 'verbose_json',
      ...(prompt ? { prompt } : {}),
    });
  } catch (err) {
    logger.error({ err: err.message }, 'stt failed');
    return { text: '', ms: Date.now() - t0, error: err.message };
  }

  const ms = Date.now() - t0;
  const text = (res?.text || '').trim();
  const confidence = judge(res?.segments);

  // No segment data (older API shape, or a stubbed client) — trust the text.
  if (confidence && text) {
    const { noSpeechProb, avgLogprob } = confidence;
    const { noSpeechProb: maxNoSpeech, minAvgLogprob } = config.groq.stt;
    if (noSpeechProb > maxNoSpeech || avgLogprob < minAvgLogprob) {
      logger.debug(
        { ms, text, noSpeechProb: +noSpeechProb.toFixed(3), avgLogprob: +avgLogprob.toFixed(3) },
        'stt rejected as hallucination',
      );
      return { text: '', ms, dropped: 'low-confidence', confidence, rawText: text };
    }
  }

  logger.debug({ ms, chars: text.length, ...(confidence ?? {}) }, 'stt');
  return { text, ms, confidence };
}
