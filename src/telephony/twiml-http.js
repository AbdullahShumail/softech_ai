import express from 'express';
import twilio from 'twilio';
import { config } from '../config.js';
import { logger } from '../obs/logger.js';
import { healthSnapshot } from '../obs/health.js';

const { twiml: Twiml } = twilio;

/**
 * Verify X-Twilio-Signature. The signed URL must be exactly what Twilio called,
 * which is the public HTTPS URL — not whatever Express sees behind the TLS proxy.
 */
function validateTwilioSignature(req, res, next) {
  if (!config.twilio.validateSignatures) return next();
  const signature = req.header('X-Twilio-Signature');
  const url = `https://${config.http.publicHost}${req.originalUrl}`;
  const ok = twilio.validateRequest(config.twilio.authToken, signature, url, req.body);
  if (!ok) {
    logger.warn({ url }, 'rejected webhook: bad Twilio signature');
    return res.status(403).send('invalid signature');
  }
  next();
}

export function createHttpApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => res.json(healthSnapshot()));

  // TwiML for an outbound call: bridge the media to our websocket.
  app.post('/voice', validateTwilioSignature, (req, res) => {
    const { CallSid } = req.body;
    const response = new Twiml.VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: `wss://${config.http.publicHost}/media` });
    logger.info({ callSid: CallSid }, 'served /voice TwiML');
    res.type('text/xml').send(response.toString());
  });

  // Call lifecycle callbacks (initiated | ringing | answered | completed).
  app.post('/status', validateTwilioSignature, (req, res) => {
    const { CallSid, CallStatus, CallDuration, AnsweredBy } = req.body;
    logger.info({ callSid: CallSid, CallStatus, CallDuration, AnsweredBy }, 'call status');
    // TODO(step 9): update calls/leads rows, release runner slot.
    res.sendStatus(204);
  });

  return app;
}
