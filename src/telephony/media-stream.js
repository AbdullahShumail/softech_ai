import { WebSocketServer } from 'ws';
import { callLogger } from '../obs/logger.js';
import { counters } from '../obs/health.js';

// Twilio Media Streams protocol reference:
//   inbound  events: connected | start | media | mark | stop
//   outbound events: media { payload } | mark { name } | clear
// Audio is base64 8 kHz mono µ-law, 20 ms / 160-byte frames.

/**
 * Attach the Media Streams websocket server at /media on an existing http.Server.
 * @param {import('http').Server} server
 * @param {(session: StreamSession) => void} [onSession] hook for the call runtime (later steps)
 */
export function attachMediaStream(server, onSession) {
  const wss = new WebSocketServer({ server, path: '/media' });

  wss.on('connection', (ws) => {
    const session = new StreamSession(ws);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      session._handle(msg, onSession);
    });

    ws.on('close', () => session._onClose());
    ws.on('error', (err) => {
      counters.streamErrors++;
      session.log.error({ err: err.message }, 'stream ws error');
    });
  });

  return wss;
}

export class StreamSession {
  constructor(ws) {
    this.ws = ws;
    this.streamSid = null;
    this.callSid = null;
    this.customParameters = {};
    this.log = callLogger('pending');
    this._echo = process.env.MEDIA_ECHO === 'true'; // step-3 loopback smoke test
  }

  _handle(msg, onSession) {
    switch (msg.event) {
      case 'connected':
        break;

      case 'start': {
        this.streamSid = msg.start.streamSid;
        this.callSid = msg.start.callSid;
        this.customParameters = msg.start.customParameters || {};
        this.log = callLogger(this.callSid);
        counters.activeCalls++;
        this.log.info({ streamSid: this.streamSid, format: msg.start.mediaFormat }, 'stream started');
        if (onSession) onSession(this);
        break;
      }

      case 'media':
        // msg.media.payload is base64 µ-law from the caller.
        if (this._echo) this.sendAudio(msg.media.payload);
        this.onMedia?.(msg.media);
        break;

      case 'mark':
        this.onMark?.(msg.mark.name);
        break;

      case 'stop':
        this.log.info('stream stopped');
        break;
    }
  }

  _onClose() {
    if (this.streamSid) counters.activeCalls = Math.max(0, counters.activeCalls - 1);
    this.onClose?.();
  }

  /** Queue a µ-law audio frame (base64 string or Buffer) for playback to the caller. */
  sendAudio(payload) {
    if (this.ws.readyState !== this.ws.OPEN || !this.streamSid) return;
    const b64 = Buffer.isBuffer(payload) ? payload.toString('base64') : payload;
    this.ws.send(JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload: b64 } }));
  }

  /** Ask Twilio to echo a mark back once playback reaches this point. */
  sendMark(name) {
    if (this.ws.readyState !== this.ws.OPEN || !this.streamSid) return;
    this.ws.send(JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name } }));
  }

  /** Flush Twilio's outbound audio buffer — the barge-in stop primitive. */
  clear() {
    if (this.ws.readyState !== this.ws.OPEN || !this.streamSid) return;
    this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
  }
}
