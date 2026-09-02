# B2B Outreach Voice Bot — Phase 1 Build Plan

New greenfield repo. Reuses the **recordings + classifier** architecture from `Aicca_gem`
(proven at 700 concurrent agents), ported to **Twilio** and stripped to a light footprint.

---

## 1. Scope

**In:**
- Outbound calls via Twilio, bidirectional Media Streams audio
- Groq Whisper STT → Groq Llama classifier → disposition code → pre-recorded WAV playback
- Semantic barge-in (lifted from `lib/barge-classifier.js`), stop via Twilio `clear`
- Single generic modernization pitch, fixed WAV library
- 3-turn logic engine (greeting → pitch → objection handling → transfer)
- Qualified-lead transfer to a live closer number
- SQLite for call records, dispositions, lead-runner state, DNC list
- CSV-driven lead runner with concurrency cap + calling-hours gate
- Per-call JSON logs + pino app log + `/health`, viewed through `log-viewer.html`
- PM2 on Hetzner

**Out (Phase 2+):**
- Per-lead website audit + personalized pitch audio
- `response-compositor` multi-segment splicing beyond greeting/pitch/rebuttal/close
- Any generative TTS on the live path
- Metrics stack, multi-region number pools, predictive dialing

---

## 2. Module layout

```
/src
  /telephony
    twilio-rest.js        # calls.create (originate), calls.update (transfer), hangup
    media-stream.js       # WS server: Twilio Media Streams protocol (connected/start/media/mark/stop)
    twiml-http.js         # HTTP: returns <Connect><Stream>, handles status callbacks
    mulaw.js              # G.711 μ-law <-> PCM16 (lookup tables)
  /audio
    prompt-library.js     # load prompt WAVs -> raw μ-law buffers in memory at boot
    playback.js           # 20ms/160-byte frame pacer; mark tracking; clear() on barge-in
  /asr
    groq-stt.js           # PCM -> WAV buffer -> Groq Whisper
    gates.js              # hallucination denylist, fragment gate, voicemail phrases
  /brain
    classifier.js         # Groq Llama: transcript -> {disposition, thought}
    classifier-prompt.js  # system prompt builder (disposition labels injected)
    logic-engine.js       # 3-turn state machine
    audio-map.js          # disposition -> prompt file(s)
    barge-classifier.js   # semantic barge-in (lifted, ~as-is)
  /vad
    vad.js                # node-vad on inbound decoded PCM
  /data
    db.js                 # better-sqlite3 handle + migrations
    schema.sql
    call-repo.js          # call record + disposition writes
    lead-repo.js          # lead list, runner cursor, DNC checks
  /runner
    lead-runner.js        # CSV import -> dial queue -> concurrency + hours gate
  /obs
    logger.js             # pino
    call-log.js           # per-call JSON writer + size/date rotation
    health.js             # /health + in-memory counters
  config.js               # env parsing, one place
  server.js               # wires HTTP + WS + runner
/prompts/b2b-outreach     # generic pitch WAV set
/campaigns/b2b-outreach/config.json
/tools/gen-prompts.mjs    # offline: recs.py-style batch TTS for the prompt set
log-viewer.html
ecosystem.config.cjs
```

---

## 3. Call flow (Phase 1)

1. **Runner** picks next lead — checks DNC, calling hours (lead timezone), concurrency cap.
2. **Originate:** `twilio.calls.create({ to, from: <pooled number>, url: <twiml-http>/voice,
   statusCallback, machineDetection: 'DetectMessageEnd' })`.
3. Twilio requests `/voice` → returns `<Response><Connect><Stream url="wss://HOST/media"/></Connect></Response>`.
4. **Media Streams WS** connects → `start` event carries `callSid` + `streamSid`. Create session.
5. Play **greeting (T1)** through the playback pacer.
6. Inbound `media` frames → μ-law decode → VAD → rolling buffer.
7. **Barge-in during playback:** transcribe partial → `barge-classifier` → if real speech,
   send `clear`, abandon remaining prompt, process the utterance.
8. **End of speech** (VAD trailing silence) → μ-law→WAV → Groq Whisper → gates →
   classifier → `logic-engine` → next prompt(s) via `audio-map` → playback.
9. **Qualified (AP):** `twilio.calls(callSid).update({ twiml:
   '<Response><Dial><Number>+1CLOSER</Number></Dial></Response>' })` — drops the stream,
   bridges caller ↔ closer.
10. **Terminal disposition:** play closing WAV → hangup → write call record to SQLite + JSON log.

---

## 4. Twilio-specific notes

| Concern | Approach |
|---|---|
| Audio format | Media Streams = 8 kHz mono μ-law, 20 ms frames (160 bytes). Pre-convert all prompt WAVs to raw μ-law once at boot; decode inbound for VAD/STT. |
| Barge-in stop | Send `{"event":"clear","streamSid":...}` — flushes Twilio's buffer instantly. No look-ahead pacing needed (unlike `mod_audio_stream`). |
| "Prompt finished" timing | Send a `mark` after queuing each prompt; Twilio echoes it back when playback reaches it. Replaces WAV-header duration math. |
| Voicemail | `MachineDetection=DetectMessageEnd` on originate + keep the transcript phrase gate as backup. AMD adds ~2–4 s detection latency — acceptable for outbound. |
| Transfer | `calls.update` with new TwiML `<Dial>`. No FreeSWITCH-style `uuid_deflect`. |
| Status/lifecycle | `statusCallback` webhook (`initiated`/`ringing`/`answered`/`completed`) drives runner state + call records. |
| Number reputation | Pooled `from` numbers, local presence match on area code, register for STIR/SHAKEN. Rotate numbers, cap calls/number/day. Set up before volume. |

---

## 5. Lift from `Aicca_gem`

| Source | Target | Change |
|---|---|---|
| `lib/barge-classifier.js` | `src/brain/barge-classifier.js` | ~as-is |
| `lib/classifier-prompt.js` | `src/brain/classifier-prompt.js` | new label set |
| `lib/hallucination-denylist.js`, `lib/short-answer-gate.js` | `src/asr/gates.js` | merge |
| 3-turn machine in `bot-server.js` (+ `__tests__/logic-engine.test.js`) | `src/brain/logic-engine.js` | extract, reshape dispositions for B2B |
| `lib/smart_audio_map.js` | `src/brain/audio-map.js` | reshape |
| `lib/call-session.js` (built, never wired) | `src/brain/session FSM` | wire it this time |
| `rawToWav()` helper in `bot-server.js` | `src/asr/groq-stt.js` | add μ-law decode in front |
| `log-viewer.html` | root | ~as-is |
| `recs.py` | `tools/gen-prompts.mjs` | Phase 1: generate the generic prompt set |

**Do NOT lift:** `modesl`/ESL layer, Vicidial APIs, `prom-client`/`grafana/`, `mongoose`,
the "live human advisor" prompt framing, `stream-out.js` look-ahead pacer (Twilio `clear`
makes it unnecessary).

---

## 6. Dependencies

**Add:** `twilio`, `better-sqlite3`, `pino`, `ws`, `openai` (Groq base URL), `node-vad`, `csv-parse`
**Drop vs old repo:** `modesl`, `mongoose`, `prom-client`, `@google-cloud/vertexai`, `@google/genai`,
`onnxruntime-node` (unless Silero VAD chosen), `google-auth-library`

---

## 7. Data model (SQLite)

```sql
leads(id, phone, company, timezone, status, attempts, last_attempt_at, do_not_call)
calls(id, call_sid, lead_id, started_at, ended_at, answered, final_disposition,
      pitch_delivered, transferred, recording_url, duration_s)
call_turns(id, call_id, turn, transcript, disposition, thought, latency_ms, ts)
dnc(phone, added_at, source)
runner_state(key, value)   -- cursor, paused flag
```

---

## 8. Compliance checklist (before dialing)

- [ ] Scrub lead list against federal + state DNC and internal `dnc` table
- [ ] Calling hours enforced per lead timezone (8:00–21:00 local)
- [ ] Bot identifies itself and the company at call open — no deceptive "live human" framing
- [ ] Honor "remove me" / "do not call" in real time → write to `dnc`, hang up
- [ ] Per-number daily call cap + retry backoff
- [ ] Consult counsel on TCPA / B2B applicability for the target list before Phase 1 dials

---

## 9. Open decisions

1. **VAD:** `node-vad` (simple, Phase-1-adequate) vs Silero (`lib/silero-vad.js` exists, better accuracy, native dep). Recommend `node-vad` for Phase 1.
2. **Closer transfer target:** PSTN number vs SIP URI vs Twilio conference.
3. **Number pool size** and area-code strategy.
4. **Hosting the WSS endpoint:** public TLS on the Hetzner box (Twilio must reach it) — cert + firewall.
5. **Retry policy:** attempts per lead, days between, no-answer vs busy vs voicemail handling.

---

## 10. Suggested build order

1. `config.js`, `db.js` + schema, `logger.js`
2. `mulaw.js` + unit tests (round-trip a known WAV)
3. `twiml-http.js` + `media-stream.js` — get a call connected, echo audio back
4. `prompt-library.js` + `playback.js` — play the greeting on a live call, verify `mark`
5. `groq-stt.js` + `vad.js` + `gates.js` — transcribe caller speech
6. `classifier.js` + `logic-engine.js` + `audio-map.js` — full turn loop
7. `barge-classifier.js` + `clear` wiring
8. `twilio-rest.js` transfer path
9. `lead-runner.js` + `call-repo.js` + status callbacks
10. `health.js`, log rotation, PM2 config, TLS on Hetzner
11. One full supervised end-to-end call before any list dialing
