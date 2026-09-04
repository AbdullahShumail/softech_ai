import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true');

/** A real E.164 destination, not an unset placeholder. */
function isRealNumber(n) {
  const digits = String(n).replace(/[^0-9]/g, '');
  if (digits.length < 10) return false;
  return !/^1?0+$/.test(digits);
}

export const config = {
  env: process.env.NODE_ENV || 'development',

  http: {
    port: num(process.env.HTTP_PORT, 8080),
    // Bind loopback-only by default: Caddy terminates TLS and proxies to us, so
    // exposing 8080 publicly would let anyone reach /voice and /media over plain
    // HTTP, bypassing TLS and Twilio signature checks. Override for local dev.
    bindHost: process.env.BIND_HOST || '127.0.0.1',
    // Hostname Twilio dials back to for the Media Stream websocket (no protocol).
    publicHost: process.env.PUBLIC_HOST || '',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '',
    validateSignatures: bool(process.env.TWILIO_VALIDATE_SIGNATURES, true),
    // Browser (WebRTC) calling — lets you talk to the bot from a web page with
    // no phone call, so no international rates and no geo permissions needed.
    apiKeySid: process.env.TWILIO_API_KEY_SID || '',
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET || '',
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID || '',
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    sttModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
    llmModel: process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-20b',
    // gpt-oss models emit hidden reasoning tokens before content. Keep effort low
    // and max_tokens well above the JSON size or `content` comes back empty.
    reasoningEffort: process.env.GROQ_REASONING_EFFORT || 'low',
    classifierMaxTokens: num(process.env.GROQ_CLASSIFIER_MAX_TOKENS, 400),
  },

  db: {
    // node --test sets NODE_TEST_CONTEXT in each test child. Without this, running
    // the suite on a live box writes fixture leads into the production database
    // (and a seeded lead could then actually get dialed).
    path:
      process.env.DB_PATH ||
      (process.env.NODE_TEST_CONTEXT ? './data/test.db' : './data/bot.db'),
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
    // A placeholder like +10000000000 passes a truthiness check and then gets
    // DIALLED, dropping the call at the exact moment it qualified. Treat an
    // all-zeros number as "no closer", so the bot captures the lead instead of
    // promising a transfer it cannot make.
    enabled: isRealNumber(process.env.CLOSER_NUMBER || ''),
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
