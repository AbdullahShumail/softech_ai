# b2b-outreach-bot

Outbound B2B voice bot. Twilio Media Streams telephony, Groq Whisper STT, Groq Llama
intent classifier, pre-recorded WAV response library. Descendant of the `Aicca_gem`
recordings architecture, ported to Twilio and trimmed for low-concurrency deployment.

See [docs/PHASE1-PLAN.md](docs/PHASE1-PLAN.md) for scope, module map, and build order.

## Status

**Phase 1 code-complete.** Full turn loop: Twilio Media Streams ⇄ µ-law codec ⇄
energy VAD ⇄ Groq Whisper STT ⇄ text gates ⇄ Groq Llama classifier ⇄ 3-turn logic
engine ⇄ mark-tracked WAV playback with `clear`-on-barge-in ⇄ Twilio REST
transfer/hangup ⇄ CSV lead runner (concurrency cap, per-lead calling hours) ⇄
SQLite + per-call JSON logs + retention prune. 55 tests, `node --test`.

**Left to do (needs you):** Twilio + Groq creds, a TLS domain on the VM, the 22
prompt WAVs, deploy, one supervised end-to-end call. See
[docs/GO-LIVE-CHECKLIST.md](docs/GO-LIVE-CHECKLIST.md) and
[docs/DEPLOY-HETZNER.md](docs/DEPLOY-HETZNER.md).

Drop 8 kHz (or any-rate) mono WAV prompts into `prompts/b2b-outreach/` — see
[docs/PROMPTS.md](docs/PROMPTS.md). Missing names are logged at startup.

## Setup

```bash
npm install
cp .env.example .env    # fill in Twilio + Groq + PUBLIC_HOST
npm run migrate
npm test
```

## Run

```bash
npm start                       # dev
pm2 start ecosystem.config.cjs  # Hetzner
```

`PUBLIC_HOST` must be an internet-reachable TLS hostname that terminates to this
process — Twilio connects inbound to `wss://$PUBLIC_HOST/media`.

## Smoke test (step 3)

Set `MEDIA_ECHO=true`, point a Twilio number's voice webhook (or an outbound call's
`url`) at `https://$PUBLIC_HOST/voice`, place a call — you should hear your own voice
looped back. Confirms the Media Streams transport end to end.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /voice` | TwiML: `<Connect><Stream>` to `/media` |
| `POST /status` | Twilio call lifecycle callbacks |
| `GET /health` | in-memory counters (no Prometheus) |
| `WS /media` | Twilio Media Streams audio |
