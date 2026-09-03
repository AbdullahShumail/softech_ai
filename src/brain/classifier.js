import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../obs/logger.js';
import { DISPOSITIONS } from './dispositions.js';

const defaultClient = new OpenAI({
  apiKey: config.groq.apiKey,
  baseURL: config.groq.baseURL,
});

const VALID = new Set(Object.keys(DISPOSITIONS));

function coerceDecisionMaker(v) {
  return v === true ? true : v === false ? false : null;
}

/**
 * Classify one caller utterance into a disposition code.
 * @param {object} args
 * @param {string} args.systemPrompt   from buildClassifierSystemPrompt()
 * @param {{role:'user'|'assistant', content:string}[]} [args.history]
 * @param {string} args.utterance
 * @param {OpenAI} [args.client]        injectable for tests
 * @returns {Promise<{disposition:string, thought:string, decisionMaker:(boolean|null), tokens:number, ms:number}>}
 */
export async function classify({ systemPrompt, history = [], utterance, client = defaultClient }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: utterance },
  ];

  const t0 = Date.now();
  let out = { disposition: 'R', thought: 'classifier error', decisionMaker: null, tokens: 0 };

  try {
    const res = await client.chat.completions.create({
      model: config.groq.llmModel,
      messages,
      temperature: 0,
      max_tokens: config.groq.classifierMaxTokens,
      response_format: { type: 'json_object' },
      ...(config.groq.reasoningEffort ? { reasoning_effort: config.groq.reasoningEffort } : {}),
    });
    const raw = res.choices?.[0]?.message?.content ?? '{}';
    const obj = JSON.parse(raw);
    const disp = String(obj.disposition ?? '').toUpperCase().trim();
    out = {
      disposition: VALID.has(disp) ? disp : 'R',
      thought: String(obj.thought ?? '').slice(0, 120),
      decisionMaker: coerceDecisionMaker(obj.is_decision_maker),
      tokens: res.usage?.total_tokens ?? 0,
    };
  } catch (err) {
    logger.error({ err: err.message, utterance }, 'classify failed');
  }

  const ms = Date.now() - t0;
  logger.debug({ ms, disposition: out.disposition, dm: out.decisionMaker }, 'classify');
  return { ...out, ms };
}
