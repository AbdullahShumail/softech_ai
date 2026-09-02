import { Playback } from '../audio/playback.js';
import { Endpointer } from '../vad/endpointer.js';
import { mulawToPcm16, pcm16ToMulaw } from '../telephony/mulaw.js';
import { transcribeMulaw } from '../asr/groq-stt.js';
import { screenTranscript } from '../asr/gates.js';
import { classify } from '../brain/classifier.js';
import { buildClassifierSystemPrompt } from '../brain/classifier-prompt.js';
import { classifyBarge } from '../brain/barge-classifier.js';
import { decide, freshState } from '../brain/logic-engine.js';
import { PROMPTS } from '../brain/audio-map.js';

const FRAME_BYTES = 320; // 160 samples PCM16 = 20 ms @ 8 kHz
const PREROLL_FRAMES = 12; // ~240 ms kept before speech-start
const MIN_UTTERANCE_MS = 300;

// Orchestrates one answered call: greet → (listen → transcribe → classify →
// decide → play) loop → transfer or hang up. Injectables in `deps` keep it
// testable without Twilio/Groq.
export class CallSession {
  constructor({ stream, library, campaign, callSid, deps = {} }) {
    this.stream = stream;
    this.library = library;
    this.campaign = campaign;
    this.callSid = callSid;
    this.deps = {
      transcribe: transcribeMulaw,
      classify,
      transfer: async () => {},
      hangup: async () => {},
      onFinal: () => {},
      log: null,
      repo: null,
      callId: null,
      ...deps,
    };

    this.state = freshState();
    this.sys = buildClassifierSystemPrompt(campaign);
    this.history = [];
    this.playback = deps.playback || new Playback(stream, library);
    this.endpointer = new Endpointer();

    this.phase = 'init'; // init | speaking | listening | processing | done
    this.done = false;
    this.capturing = false;
    this.captureChunks = [];
    this.captureMs = 0;
    this.preroll = [];
    this.barged = false;
    this.lastPrompts = [];

    stream.onMedia = (m) => this._onMedia(m);
    stream.onMark = (name) => this.playback.onMark(name);
    stream.onClose = () => this._end('HU', { reason: 'stream-closed' });
  }

  async start() {
    this._log('greeting');
    await this._say([PROMPTS.greeting], { bargeable: false });
    this._listen();
  }

  // ---- audio in ----

  _onMedia(media) {
    if (this.done) return;
    const pcm = mulawToPcm16(Buffer.from(media.payload, 'base64'));
    for (let o = 0; o + FRAME_BYTES <= pcm.length; o += FRAME_BYTES) {
      const frame = pcm.subarray(o, o + FRAME_BYTES);
      const mu = pcm16ToMulaw(frame);
      const ev = this.endpointer.push(frame);

      if (ev?.type === 'speech-start') {
        this.capturing = true;
        this.captureChunks = this.preroll.slice();
        this.captureMs = this.preroll.length * 20;
        this.preroll = [];
        this._onSpeechStart();
      }

      if (this.capturing) {
        this.captureChunks.push(mu);
        this.captureMs += 20;
      } else {
        this.preroll.push(mu);
        if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      }

      if (ev?.type === 'speech-end') this._onSpeechEnd();
    }
  }

  _onSpeechStart() {
    if (this.phase === 'processing') return;
    if (this.phase === 'speaking' && this.playback.isPlaying && this._bargeable) {
      this.barged = true;
      this.playback.interrupt();
    }
  }

  _onSpeechEnd() {
    if (!this.capturing || this.phase === 'processing' || this.done) {
      this.capturing = false;
      return;
    }
    this.capturing = false;
    const mulaw = Buffer.concat(this.captureChunks);
    this.captureChunks = [];
    if (this.captureMs < MIN_UTTERANCE_MS) {
      this.captureMs = 0;
      return;
    }
    this.captureMs = 0;
    this.phase = 'processing';
    const barged = this.barged;
    this.barged = false;
    this._process(mulaw, barged).catch((err) => {
      this._log('process-error', { err: err.message });
      this._listen();
    });
  }

  // ---- one turn ----

  async _process(mulaw, barged) {
    const t0 = Date.now();
    const { text } = await this.deps.transcribe(mulaw, { prompt: this.campaign.companyName });
    const screened = screenTranscript(text);

    if (barged && screened.ok) {
      const kind = classifyBarge(text);
      if (kind === 'BACKCHANNEL' || kind === 'SIDE_TALK') {
        this._log('barge-ignored', { text, kind });
        this.phase = 'speaking';
        await this._say(this.lastPrompts.length ? this.lastPrompts : [PROMPTS.reprompt]);
        this._listen();
        return;
      }
    }

    let disposition;
    let thought;
    let decisionMaker = null;
    const loggedTranscript = screened.text || text || '';

    if (!screened.ok) {
      disposition = screened.reason === 'voicemail' ? 'AM' : 'R';
      thought = screened.reason;
    } else {
      const c = await this.deps.classify({
        systemPrompt: this.sys,
        history: this.history,
        utterance: screened.text,
      });
      disposition = c.disposition;
      thought = c.thought;
      decisionMaker = c.decisionMaker;
      this.history.push({ role: 'user', content: screened.text });
    }

    const result = decide(disposition, decisionMaker, this.state, this.campaign);
    Object.assign(this.state, result.updates);

    const turnRec = {
      turn: this.state.turn,
      transcript: loggedTranscript,
      disposition,
      thought,
      latencyMs: Date.now() - t0,
    };
    this.deps.repo?.recordTurn?.(this.deps.callId, turnRec);
    this.deps.log?.turn?.(turnRec);

    if (result.prompts?.length) {
      this.history.push({ role: 'assistant', content: `(plays ${result.prompts.join(', ')})` });
    }

    this.phase = 'speaking';
    if (result.action === 'transfer') {
      await this._say(result.prompts, { bargeable: false });
      await this.deps.transfer(this.callSid);
      this._end('QUAL', { transferred: true });
      return;
    }
    if (result.action === 'hangup') {
      await this._say(result.prompts, { bargeable: false });
      await this.deps.hangup(this.callSid);
      this._end(result.finalDisposition || disposition);
      return;
    }
    await this._say(result.prompts);
    this._listen();
  }

  // ---- helpers ----

  async _say(prompts, { bargeable = true } = {}) {
    if (this.done || !prompts?.length) return;
    this.lastPrompts = prompts;
    this._bargeable = bargeable;
    await this.playback.play(prompts);
  }

  _listen() {
    if (this.done) return;
    this.phase = 'listening';
    this.endpointer.reset();
    this.capturing = false;
    this.captureChunks = [];
    this.captureMs = 0;
    this.preroll = [];
  }

  _end(finalDisposition, extra = {}) {
    if (this.done) return;
    this.done = true;
    this.phase = 'done';
    this.playback.interrupt();
    const summary = {
      finalDisposition,
      pitchDelivered: this.state.pitchDelivered,
      transferred: !!extra.transferred,
      ...extra,
    };
    this.deps.log?.finalize?.(summary);
    this.deps.onFinal?.(summary);
  }

  _log(type, detail) {
    this.deps.log?.event?.(type, detail);
  }
}
