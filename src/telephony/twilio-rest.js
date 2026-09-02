import twilio from 'twilio';
import { config } from '../config.js';
import { logger } from '../obs/logger.js';

const client =
  config.twilio.accountSid && config.twilio.authToken
    ? twilio(config.twilio.accountSid, config.twilio.authToken)
    : null;

function requireClient() {
  if (!client) throw new Error('Twilio REST not configured (missing SID/token)');
  return client;
}

/** Place an outbound call; TwiML is served from /voice. Returns the Call SID. */
export async function originate({ to, leadId = null }) {
  const base = `https://${config.http.publicHost}`;
  const call = await requireClient().calls.create({
    to,
    from: config.twilio.fromNumber,
    url: `${base}/voice`,
    statusCallback: `${base}/status`,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    machineDetection: 'DetectMessageEnd',
    machineDetectionTimeout: 5,
  });
  logger.info({ callSid: call.sid, to, leadId }, 'call originated');
  return call.sid;
}

/** Redirect the live call to a closer — drops the media stream, bridges PSTN↔PSTN. */
export async function transferToCloser(callSid) {
  const closer = config.transfer.closerNumber;
  if (!closer) throw new Error('CLOSER_NUMBER not set');
  const vr = new twilio.twiml.VoiceResponse();
  vr.dial({ callerId: config.twilio.fromNumber }).number(closer);
  await requireClient().calls(callSid).update({ twiml: vr.toString() });
  logger.info({ callSid, closer }, 'call transferred to closer');
}

export async function hangup(callSid) {
  if (!client) return;
  try {
    await client.calls(callSid).update({ status: 'completed' });
  } catch (err) {
    logger.warn({ callSid, err: err.message }, 'hangup request failed (call may already be over)');
  }
}
