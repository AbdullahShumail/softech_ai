import { Playback } from '../audio/playback.js';
import { Endpointer } from '../vad/endpointer.js';
import { mulawToPcm16, pcm16ToMulaw } from '../telephony/mulaw.js';
import { transcribeMulaw } from '../asr/groq-stt.js';
import { screenTranscript } from '../asr/gates.js';
import { classify } from '../brain/classifier.js';
import { buildClassifierSystemPrompt } from '../brain/classifier-prompt.js';
import { classifyBarge } from '../brain/barge-classifier.js';
import { fastPath } from '../brain/fast-path.js';
import { decide, freshState } from '../brain/logic-engine.js';
import { PROMPTS, ACK_PROMPTS } from '../brain/audio-map.js';
import { spokenText, ellipsis } from '../audio/prompt-text.js';

const FRAME_BYTES = 320; // 160 samples PCM16 = 20 ms @ 8 kHz
const PREROLL_FRAMES = 12; // ~240 ms kept before speech-start
const MIN_UTTERANCE_MS = 400;
// Whisper invents words from silence ("Thank you.", "Daniels", stray Icelandic).
// If a captured segment never got meaningfully loud, drop it before spending an
// STT call on it. Peak, not mean: every capture ends with ~700 ms of trailing
// silence, which would drag a short real utterance below any mean threshold.
const MIN_CAPTURE_PEAK_RMS = 700;
// An ack is only worth playing if it is shorter than the wait it hides. We hold
// the turn until the ack finishes (cutting it off mid-word sounds worse than
// silence), so an ack longer than a classifier call would make the turn slower
// rather than faster. Anything over this is skipped — which also means a badly
// generated ack library degrades to "no acks" instead of to a sluggish bot.
const MAX_ACK_MS = 600;

// Orchestrates one answered call: greet → (listen → transcribe → classify →
// decide → play) loop → transfer or hang up. Injectables in `deps` keep it
// testable without Twilio/Groq.
//
// Three things exist purely to keep the gap between "caller stops" and "bot
// starts" near human turn-taking (~200 ms) rather than the ~1.8 s a strictly
// serial pipeline costs:
//
//   1. Speculative STT — the endpointer's provisional end starts transcription
//      ~340 ms before we are sure the caller finished. If they carry on, the
//      work is discarded.
//   2. The fast path — most cold-call replies are unambiguous, so they skip the
//      classifier entirely and cost 0 ms instead of ~650 ms.
//   3. Acknowledgement tokens — when we DO have to wait on the LLM, a 250 ms
//      "mm-hm" goes out first, so the caller hears a reply while we think.
export class CallSession {
  constructor({ stream, library, campaign, callSid, deps = {} }) {
    this.stream = stream;
    this.library = library;
    this.campaign = campaign;
    this.callSid = callSid;
    this.deps = {
      transcribe: transcribeMulaw,
      classify,
      prewarm: () => {},
      // Beat of silence before the bot speaks. Answering a call and being talked
      // at the instant you say hello is the tell of a robocall.
      openingDelayMs: 1500,
      transfer: async () => {},
      // False when no closer is configured: qualify, capture, and close honestly
      // rather than promising a hand-off that would drop the call.
      transferEnabled: true,
      hangup: async () => {},
      onFinal: () => {},
      log: null,
      repo: null,
      callId: null,
      ...deps,
    };

    this.state = freshState();
    this.sys = buildClassifierSystemPrompt(campaign);
    // Whisper's prompt BIASES the decoder toward the words in it. Priming it with
    // our own company name made it decode the bot's echo as that name
    // ("Softech Innovative Sources" appeared in a live transcript). Bias toward
    // what the CALLER is likely to say instead.
    this.sttPrompt = campaign.sttPrompt || '';
    this.history = [];
    this.playback = deps.playback || new Playback(stream, library);
    this.endpointer = new Endpointer();

    this.phase = 'init'; // init | speaking | listening | processing | done
    this.done = false;
    this.capturing = false;
    this.captureChunks = [];
    this.captureMs = 0;
    this.capturePeakRms = 0;
    this.preroll = [];
    this.barged = false;
    this.lastPrompts = [];

    this._spec = null; // in-flight speculative transcription
    // Start each call at a different point in the ack rotation so two calls in
    // a row don't open with the same noise.
    this._ackIdx = Math.floor(Math.random() * ACK_PROMPTS.length);

    stream.onMedia = (m) => this._onMedia(m);
    stream.onMark = (name) => this.playback.onMark(name);
    stream.onClose = () => this._end('HU', { reason: 'stream-closed' });
  }

  async start() {
    // Warm the Groq connection while the greeting plays, so the first real turn
    // doesn't also pay for DNS + TLS + model routing.
    try {
      this.deps.prewarm();
    } catch {
      /* never let a warm-up failure touch the call */
    }
    // Let them get "hello?" out before we say anything.
    const wait = this.deps.openingDelayMs ?? 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (this.done) return;

    // Turn 0: the agent speaks first, so it is not a "turn" in the state machine
    // sense, but a transcript that starts mid-conversation is useless.
    //
    // hello + greeting go out as ONE play list, which makes the natural reply
    // work for free: "good thanks" barges in, playback reports `greeting` as the
    // unheard remainder, the barge classifier reads it as a backchannel, and the
    // greeting resumes. The automated-call identification is never skipped.
    const openingPrompts = [PROMPTS.hello, PROMPTS.greeting];
    const opening = {
      turn: 0,
      transcript: null,
      disposition: null,
      thought: null,
      latencyMs: 0,
      route: 'open',
      prompts: openingPrompts,
      agentText: spokenText(openingPrompts),
    };
    this._log('greeting', { agentText: opening.agentText });
    this.deps.repo?.recordTurn?.(this.deps.callId, opening);
    this.deps.log?.turn?.(opening);
    this.stream?.log?.info(
      { prompts: opening.prompts, said: opening.agentText },
      `turn 0 | agent: "${ellipsis(opening.agentText)}"`,
    );
    await this._say(openingPrompts); // interruptible — people answer over the opener
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
        this.capturePeakRms = 0;
        this.preroll = [];
        this._onSpeechStart();
      }

      if (this.capturing) {
        this.captureChunks.push(mu);
        this.captureMs += 20;
        if (this.endpointer.lastRms > this.capturePeakRms) {
          this.capturePeakRms = this.endpointer.lastRms;
        }
      } else {
        this.preroll.push(mu);
        if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      }

      if (ev?.type === 'speech-resume') this._onSpeechResume();
      if (ev?.type === 'speech-end') {
        if (ev.reason === 'provisional') this._onSpeechProvisional();
        else this._onSpeechEnd();
      }
    }
  }

  _onSpeechStart() {
    if (this.phase === 'processing') return;
    if (this.phase === 'speaking' && this.playback.isPlaying && this._bargeable) {
      this.barged = true;
      this.playback.interrupt();
      // Twilio's buffer is flushed, so we are no longer at risk of hearing our
      // own audio — stop holding the loudness bar high against the caller.
      this.endpointer.setStrict(false);
    }
  }

  /**
   * The caller has probably finished, but we won't be sure for another ~340 ms.
   * Start transcribing now against that bet.
   */
  _onSpeechProvisional() {
    if (!this.capturing || this.phase === 'processing' || this.done) return;
    if (this._spec) return;
    if (this.captureMs < MIN_UTTERANCE_MS) return;
    if (this.capturePeakRms < MIN_CAPTURE_PEAK_RMS) return;

    const mulaw = Buffer.concat(this.captureChunks);
    this._spec = {
      promise: Promise.resolve()
        .then(() => this.deps.transcribe(mulaw, { prompt: this.sttPrompt }))
        .catch((err) => {
          this._log('stt-speculative-failed', { err: err.message });
          return null; // fall back to a fresh call on commit
        }),
    };
    this._log('stt-speculative', { ms: this.captureMs });
  }

  /** They were only drawing breath — the speculative transcript is now short. */
  _onSpeechResume() {
    if (!this._spec) return;
    this._spec = null;
    this._log('stt-speculative-discarded');
  }

  _onSpeechEnd() {
    if (!this.capturing || this.phase === 'processing' || this.done) {
      this.capturing = false;
      this._spec = null;
      return;
    }
    this.capturing = false;
    const mulaw = Buffer.concat(this.captureChunks);
    const peakRms = this.capturePeakRms;
    const heldMs = this.captureMs;
    const spec = this._spec;
    this._spec = null;
    this.captureChunks = [];
    this.captureMs = 0;
    this.capturePeakRms = 0;

    if (heldMs < MIN_UTTERANCE_MS) return;
    if (peakRms < MIN_CAPTURE_PEAK_RMS) {
      this._log('capture-too-quiet', { ms: heldMs, peakRms: Math.round(peakRms) });
      return; // don't burn an STT call on room tone
    }
    this.phase = 'processing';
    const barged = this.barged;
    this.barged = false;
    this._process(mulaw, barged, spec).catch((err) => {
      this._log('process-error', { err: err.message });
      this._listen();
    });
  }

  // ---- one turn ----

  async _process(mulaw, barged, spec) {
    const t0 = Date.now();

    // The speculative transcript covers the same speech minus its trailing
    // silence, so it stands in for the committed one whenever it survived.
    let stt = spec ? await spec.promise : null;
    if (stt) this._log('stt-speculative-used');
    else stt = await this.deps.transcribe(mulaw, { prompt: this.sttPrompt });

    const text = stt?.text ?? '';
    const screened = screenTranscript(text);

    if (barged && screened.ok) {
      const kind = classifyBarge(text);
      if (kind === 'BACKCHANNEL' || kind === 'SIDE_TALK') {
        this._log('barge-ignored', { text, kind });
        this.phase = 'speaking';
        // lastPrompts holds only what they had not heard yet, so this picks up
        // where the interruption landed instead of restarting the whole turn.
        await this._say(this.lastPrompts.length ? this.lastPrompts : [PROMPTS.reprompt]);
        this._listen();
        return;
      }
    }

    let disposition;
    let thought;
    let decisionMaker = null;
    let hints = {};
    let route = 'llm';
    const loggedTranscript = screened.text || text || '';

    if (!screened.ok) {
      disposition = screened.reason === 'voicemail' ? 'AM' : 'R';
      thought = screened.reason;
      route = 'gate';
    } else {
      const fp = fastPath(screened.text, {
        awaitingDecisionMaker: this.state.awaitingDecisionMaker,
        pitchDelivered: this.state.pitchDelivered,
      });
      this.history.push({ role: 'user', content: screened.text });

      if (fp) {
        ({ disposition, thought, decisionMaker, hints } = fp);
        route = 'fast';
      } else {
        // Only now is a wait actually coming, so cover it with a short ack.
        const ackPlaying = this._sayAck();
        const c = await this.deps.classify({
          systemPrompt: this.sys,
          history: this.history.slice(0, -1),
          utterance: screened.text,
        });
        await ackPlaying;
        disposition = c.disposition;
        thought = c.thought;
        decisionMaker = c.decisionMaker;
      }
    }

    const result = decide(disposition, decisionMaker, this.state, this.campaign, hints);
    Object.assign(this.state, result.updates);

    const turnRec = {
      turn: this.state.turn,
      transcript: loggedTranscript,
      disposition,
      thought,
      latencyMs: Date.now() - t0,
      route,
      prompts: result.prompts ?? [],
      agentText: spokenText(result.prompts),
    };
    this.deps.repo?.recordTurn?.(this.deps.callId, turnRec);
    this.deps.log?.turn?.(turnRec);
    this._logTurn(turnRec);

    if (result.prompts?.length) {
      this.history.push({ role: 'assistant', content: `(plays ${result.prompts.join(', ')})` });
    }

    this.phase = 'speaking';
    if (result.action === 'transfer') {
      if (!this.deps.transferEnabled) {
        this._log('qualified-captured', { reason: 'no closer configured' });
        await this._say([PROMPTS.qualifiedCapture], { bargeable: false });
        await this.deps.hangup(this.callSid);
        this._end('QUAL', { transferred: false, captured: true });
        return;
      }
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

  /**
   * @param {string[]} prompts
   * @param {object}  [opts]
   * @param {boolean} [opts.bargeable=true]
   * @param {boolean} [opts.remember=true] track for barge-in resume — false for
   *   throwaway audio like acks, which must never be replayed
   */
  async _say(prompts, { bargeable = true, remember = true } = {}) {
    if (this.done || !prompts?.length) return null;
    if (remember) this.lastPrompts = prompts;
    this._bargeable = bargeable;
    this.endpointer.setStrict(true); // reject our own audio echoing back
    const res = await this.playback.play(prompts);
    if (remember && res && !res.completed && res.remaining?.length) {
      this.lastPrompts = res.remaining; // resume point for a backchannel
    }
    return res;
  }

  /** Fire-and-hold a short "I heard you" while the classifier runs. */
  _sayAck() {
    const name = ACK_PROMPTS[this._ackIdx % ACK_PROMPTS.length];
    this._ackIdx++;
    const ms = this.library?.durationMs?.(name);
    if (ms != null && ms > MAX_ACK_MS) {
      this._log('ack-too-long', { name, ms: Math.round(ms) });
      return null; // costs more than the wait it would cover
    }
    return this._say([name], { bargeable: false, remember: false });
  }

  _listen() {
    if (this.done) return;
    this.phase = 'listening';
    this.endpointer.reset();
    this.endpointer.setStrict(false);
    this.capturing = false;
    this.captureChunks = [];
    this.captureMs = 0;
    this.capturePeakRms = 0;
    this.preroll = [];
    this._spec = null;
  }

  _end(finalDisposition, extra = {}) {
    if (this.done) return;
    this.done = true;
    this.phase = 'done';
    this._spec = null;
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

  /**
   * One readable line per turn for `pm2 logs` — both sides of the exchange, the
   * disposition, and which path decided it. Structured fields stay attached for
   * anything that parses the JSON.
   */
  _logTurn(t) {
    const caller = ellipsis(t.transcript) || '(nothing intelligible)';
    const agent = ellipsis(t.agentText) || '(silence)';
    this.stream?.log?.info(
      {
        turn: t.turn,
        heard: t.transcript,
        disposition: t.disposition,
        route: t.route,
        ms: t.latencyMs,
        prompts: t.prompts,
        said: t.agentText,
      },
      `turn ${t.turn} | caller: "${caller}" | ${t.disposition} (${t.route}, ${t.latencyMs}ms) | agent: "${agent}"`,
    );
  }
}
