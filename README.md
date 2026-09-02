# b2b-outreach-bot

Outbound B2B voice bot. Twilio Media Streams telephony, Groq Whisper STT, Groq Llama
intent classifier, pre-recorded WAV response library. Descendant of the `Aicca_gem`
recordings architecture, ported to Twilio and trimmed for low-concurrency deployment.

See [docs/PHASE1-PLAN.md](docs/PHASE1-PLAN.md) for scope, module map, and build order.

## Status

Phase 1. Done: full inbound→outbound turn loop —
Twilio Media Streams ⇄ µ-law codec ⇄ energy VAD ⇄ Groq Whisper STT ⇄ text gates ⇄
Groq Llama classifier ⇄ 3-turn logic engine ⇄ mark-tracked WAV playback with
`clear`-on-barge-in ⇄ Twilio REST transfer/hangup ⇄ SQLite + per-call JSON logs.
48 tests. Not yet: lead runner (CSV dialer), TLS/deploy, real prompt WAVs.

Drop 8 kHz (or any-rate) mono WAV prompts into `prompts/b2b-outreach/` — converted
to µ-law and held in memory at boot, keyed by filename. Required names are logged
at startup (`prompt files referenced by audio-map are missing`).

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
