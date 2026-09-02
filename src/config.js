import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true');

export const config = {
  env: process.env.NODE_ENV || 'development',

  http: {
    port: num(process.env.HTTP_PORT, 8080),
    // Hostname Twilio dials back to for the Media Stream websocket (no protocol).
    publicHost: process.env.PUBLIC_HOST || '',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '',
    validateSignatures: bool(process.env.TWILIO_VALIDATE_SIGNATURES, true),
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    sttModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
    llmModel: process.env.GROQ_LLM_MODEL || 'llama-3.1-8b-instant',
  },

  db: {
    path: process.env.DB_PATH || './data/bot.db',
  },

  prompts: {
    dir: process.env.PROMPT_DIR || './prompts/b2b-outreach',
  },

  campaign: {
    name: process.env.CAMPAIGN || 'b2b-outreach',
  },

  logs: {
    callDir: process.env.CALL_LOG_DIR || './logs/calls',
    retentionDays: num(process.env.CALL_LOG_RETENTION_DAYS, 30),
  },

  transfer: {
    closerNumber: process.env.CLOSER_NUMBER || '',
  },

  callingHours: {
    start: num(process.env.CALLING_HOUR_START, 8),
    end: num(process.env.CALLING_HOUR_END, 21),
  },

  runner: {
    maxConcurrent: num(process.env.MAX_CONCURRENT_CALLS, 4),
    autostart: bool(process.env.RUNNER_AUTOSTART, false),
    controlToken: process.env.CONTROL_TOKEN || '',
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

/**
 * Throw if anything required to place/handle a live call is missing.
 * Called from server.js at boot, not at import time, so tests can import freely.
 */
export function assertRuntimeConfig() {
  const missing = [];
  if (!config.twilio.accountSid) missing.push('TWILIO_ACCOUNT_SID');
  if (!config.twilio.authToken) missing.push('TWILIO_AUTH_TOKEN');
  if (!config.twilio.fromNumber) missing.push('TWILIO_FROM_NUMBER');
  if (!config.http.publicHost) missing.push('PUBLIC_HOST');
  if (!config.groq.apiKey) missing.push('GROQ_API_KEY');
  if (missing.length) {
    throw new Error(`Missing required config: ${missing.join(', ')}`);
  }
}
