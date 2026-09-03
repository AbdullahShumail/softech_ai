import twilio from 'twilio';
import { config } from '../config.js';

const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

/**
 * Mint a short-lived Access Token so a browser can place a WebRTC call into our
 * TwiML app (which points back at /voice). Outgoing only — the browser can dial
 * the bot, nothing can dial the browser.
 */
export function mintVoiceToken(identity = `tester-${Date.now()}`) {
  const { accountSid, apiKeySid, apiKeySecret, twimlAppSid } = config.twilio;
  if (!apiKeySid || !apiKeySecret || !twimlAppSid) {
    throw new Error('browser calling needs TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID');
  }
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity, ttl: 3600 });
  token.addGrant(new VoiceGrant({ outgoingApplicationSid: twimlAppSid, incomingAllow: false }));
  return { token: token.toJwt(), identity };
}
