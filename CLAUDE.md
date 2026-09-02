# b2b-outreach-bot — notes for Claude

Outbound B2B voice bot. **Recordings architecture**: STT + LLM classifier pick a
disposition code, the logic engine maps it to pre-recorded WAVs. No generative
TTS on the live path (compliance). Descendant of the FreeSWITCH `Aicca_gem` bot,
ported to Twilio and trimmed for low concurrency.

## Shape

```
Twilio Media Streams (WS /media)
  → mulaw.js decode → endpointer.js (energy VAD) → capture
  → groq-stt.js (Whisper) → gates.js (drop noise/voicemail/fragments)
  → [barge-classifier.js if interrupting]
  → classifier.js (Llama → disposition + decisionMaker)
  → logic-engine.js decide() → { continue | transfer | hangup, prompts[] }
  → playback.js (chunked media + mark; clear() on barge-in)
  → twilio-rest.js transfer/hangup
persisted: SQLite (call-repo, lead-repo) + logs/calls/<sid>.json
dialer: runner/lead-runner.js (CSV → originate, concurrency cap, calling hours)
```

## Conventions
- ESM, Node 20+. Tests: `node --test` (no jest). `npm test`.
- Every external dep (Groq, Twilio) is injectable via `deps` / `client` args so
  tests run offline. Keep it that way.
- `config.js` is the only place that reads `process.env`.
- Disposition codes are stable identifiers — logged, mapped to audio and CRM.
  Add to `dispositions.js` + `audio-map.js` + `classifier-prompt.js` together.
- `assertRuntimeConfig()` runs at boot only, never at import.

## Don't
- Don't add a generative-TTS live path without explicit compliance sign-off.
- Don't remove the automated-call identification from `greeting` / `ans-bot`.
- Don't commit `.env`, `data/*.db`, or real lead data.

## Not built yet (Phase 2)
Per-lead website audit + personalized pitch audio; retry policy in the runner
(currently single-pass); Silero VAD behind the endpointer interface.
