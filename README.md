# b2b-outreach-bot

Outbound B2B voice bot. Twilio Media Streams telephony, Groq Whisper STT, Groq Llama
intent classifier, pre-recorded WAV response library. Descendant of the `Aicca_gem`
recordings architecture, ported to Twilio and trimmed for low-concurrency deployment.

See [docs/PHASE1-PLAN.md](docs/PHASE1-PLAN.md) for scope, module map, and build order.

## Status

Phase 1, scaffold. Done: config, SQLite, logging, µ-law codec, Twilio Media Streams
transport (echo smoke test). Not yet: STT, classifier, logic engine, playback pacer,
barge-in, transfer, lead runner.

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
