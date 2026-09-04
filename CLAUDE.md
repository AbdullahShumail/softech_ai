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
  → fast-path.js (regex; resolves most turns in 0 ms)
      ↳ miss → classifier.js (LLM → disposition + decisionMaker), ack plays meanwhile
  → logic-engine.js decide() → { continue | transfer | hangup, prompts[] }
  → playback.js (chunked media + mark per clip; clear() on barge-in)
  → twilio-rest.js transfer/hangup
persisted: SQLite (call-repo, lead-repo) + logs/calls/<sid>.json
dialer: runner/lead-runner.js (CSV → originate, concurrency cap, calling hours)
```

## Turn latency
Three mechanisms keep the gap between "caller stops" and "bot starts" near human
turn-taking rather than the ~1.8 s a serial pipeline costs. Read `session.js`
before changing any of them:
- **Speculative STT** — the endpointer emits `speech-end/provisional` at ~360 ms
  and a committing `speech-end/silence` at ~700 ms. The provisional starts
  transcription early; `speech-resume` throws it away if the caller carries on.
- **Fast path** — `fast-path.js` is a PRECISION filter. A rule that is merely
  usually right belongs in the classifier, not here. Returning null is free.
- **Ack tokens** — a short "mm-hm" covers the classifier wait. The session holds
  the turn until it finishes, so an ack longer than `MAX_ACK_MS` is skipped:
  it would cost more than the wait it hides.

## Conventions
- ESM, Node 20+. Tests: `node --test` (no jest). `npm test`.
- Every external dep (Groq, Twilio) is injectable via `deps` / `client` args so
  tests run offline. Keep it that way.
- `config.js` is the only place that reads `process.env`.
- Disposition codes are stable identifiers — logged, mapped to audio and CRM.
  Adding one touches `dispositions.js`, `audio-map.js`, `prompt-script.json` and
  the campaign's `crmMapping` together. `classifier-prompt.js` builds its table
  from `dispositions.js`, so it follows automatically.
- Rebuttals are per-code LADDERS in `audio-map.js`, indexed by
  `state.usedRebuttals[code]`. A spent ladder returns null and the engine closes
  — never let a caller hear the same line twice.
- Long turns are arrays of sentence-sized clips. Playback marks each one, so a
  barge-in resumes at the next clip instead of restarting.
- `assertRuntimeConfig()` runs at boot only, never at import.

## Don't
- Don't add a generative-TTS live path without explicit compliance sign-off.
- Don't remove the automated-call identification from `greeting` / `ans-bot`.
- Don't commit `.env`, `data/*.db`, or real lead data.

## Prompt audio
`tools/prompt-script.json` is the verbatim copy; `npm run verify-prompts` checks
the library against `audio-map.js`. Generate with
`python3 tools/gen_prompts_11labs.py --voice <name>` (needs `ELEVENLABS_API_KEY`;
`--list-voices` to browse) or the free `gen_prompts_edge.py`. Both share the same
telephony post-chain — band-limit 200-3400 Hz, compress, pad with faint room
tone, 8 kHz mono PCM16. Render at 24 kHz and downsample; never ask an engine for
8 kHz directly, and never pad with digital silence.

## Not built yet (Phase 2)
Per-lead website audit + personalized pitch audio; retry policy in the runner
(currently single-pass); Silero VAD behind the endpointer interface.
