import express from 'express';
import twilio from 'twilio';
import { config } from '../config.js';
import { logger } from '../obs/logger.js';
import { healthSnapshot } from '../obs/health.js';
import { lookupCall } from '../runner/registry.js';
import { mintVoiceToken } from './voice-token.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const { twiml: Twiml } = twilio;

/**
 * Verify X-Twilio-Signature against the exact public URL Twilio called.
 */
function validateTwilioSignature(req, res, next) {
  if (!config.twilio.validateSignatures) return next();
  const signature = req.header('X-Twilio-Signature');
  const url = `https://${config.http.publicHost}${req.originalUrl}`;
  if (!twilio.validateRequest(config.twilio.authToken, signature, url, req.body)) {
    logger.warn({ url }, 'rejected webhook: bad Twilio signature');
    return res.status(403).send('invalid signature');
  }
  next();
}

function requireControlToken(req, res, next) {
  if (!config.runner.controlToken) return res.status(503).send('control disabled (set CONTROL_TOKEN)');
  if (req.header('X-Control-Token') !== config.runner.controlToken) return res.sendStatus(403);
  next();
}

export function createHttpApp({ runner } = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => {
    res.json({ ...healthSnapshot(), runner: runner?.status?.() ?? null });
  });

  // TwiML for an outbound call: bridge media to our websocket, stamp lead params.
  app.post('/voice', validateTwilioSignature, (req, res) => {
    const { CallSid } = req.body;
    const bind = lookupCall(CallSid);
    const response = new Twiml.VoiceResponse();
    const stream = response.connect().stream({ url: `wss://${config.http.publicHost}/media` });
    if (bind?.leadId != null) stream.parameter({ name: 'leadId', value: String(bind.leadId) });
    if (bind?.phone) stream.parameter({ name: 'phone', value: bind.phone });
    logger.info({ callSid: CallSid, leadId: bind?.leadId ?? null }, 'served /voice TwiML');
    res.type('text/xml').send(response.toString());
  });

  // Call lifecycle callbacks (initiated | ringing | answered | completed).
  app.post('/status', validateTwilioSignature, (req, res) => {
    const { CallSid, CallStatus, CallDuration, AnsweredBy } = req.body;
    logger.info({ callSid: CallSid, CallStatus, CallDuration, AnsweredBy }, 'call status');
    if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus)) {
      runner?.onCallComplete?.(CallSid);
    }
    res.sendStatus(204);
  });

  // ---- Browser click-to-call test page ----
  // Gated by the control token: an access token lets the holder place calls
  // billed to this Twilio account, so it must not be world-readable.
  const checkKey = (req, res) => {
    const k = req.query.k || req.header('X-Control-Token');
    if (!config.runner.controlToken) {
      res.status(503).send('set CONTROL_TOKEN to enable the test page');
      return false;
    }
    if (k !== config.runner.controlToken) {
      res.status(403).send('bad or missing ?k= token');
      return false;
    }
    return true;
  };

  app.get('/call', (req, res) => {
    if (!checkKey(req, res)) return;
    res.type('html').send(readFileSync(join(here, '../../public/call.html'), 'utf8'));
  });

  // Brand mark, also used as the favicon. The call page inlines the same SVG.
  app.get('/logo.svg', (_req, res) => {
    res.type('image/svg+xml').send(readFileSync(join(here, '../../public/logo.svg'), 'utf8'));
  });

  app.get('/token', (req, res) => {
    if (!checkKey(req, res)) return;
    try {
      res.json(mintVoiceToken());
    } catch (err) {
      logger.error({ err: err.message }, 'token mint failed');
      res.status(500).json({ error: err.message });
    }
  });

  // Minimal dialer control (needs X-Control-Token).
  app.get('/runner', requireControlToken, (_req, res) => res.json(runner?.status?.() ?? {}));
  app.post('/runner/start', requireControlToken, (_req, res) => {
    runner?.start?.();
    res.json(runner?.status?.() ?? {});
  });
  app.post('/runner/pause', requireControlToken, (_req, res) => {
    runner?.pause?.();
    res.json(runner?.status?.() ?? {});
  });

  return app;
}
