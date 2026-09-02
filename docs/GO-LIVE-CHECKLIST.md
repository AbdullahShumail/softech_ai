# Go-live checklist

Work top to bottom. Nothing below the transport check should happen before it passes.

## Accounts & secrets
- [ ] Twilio: Account SID, Auth Token, ≥1 voice number, geo permissions for target countries
- [ ] Groq API key
- [ ] Closer phone number (rings a human), in `CLOSER_NUMBER`
- [ ] `CONTROL_TOKEN` set to a random string

## Infra
- [ ] Subdomain A record → Hetzner IPv4
- [ ] Caddy (or nginx) serving valid TLS for that host, proxying to `HTTP_PORT`
- [ ] `curl https://<host>/health` → `{ ok: true, ... }`
- [ ] PM2 running the app; `pm2 save` + `pm2 startup` done; `pm2-logrotate` installed

## Transport check (step 3)
- [ ] Twilio number's Voice webhook → `https://<host>/voice`
- [ ] With `MEDIA_ECHO=true`, place a call → you hear your own voice looped back
- [ ] Unset `MEDIA_ECHO`

## Prompts
- [ ] All 22 WAVs in `prompts/b2b-outreach/` (boot log shows no `missing` list)
- [ ] Listen to each once; check they flow together
- [ ] `greeting` and `ans-bot` clearly identify the call as automated

## Supervised end-to-end (call your own phone)
- [ ] One lead = your mobile; `node scripts/import-leads.mjs test.csv`
- [ ] `POST /runner/start` — verify: greeting plays, it hears you, classifies,
      plays the right response, advances turns
- [ ] Say "not interested" → rebuttal, then a clean close
- [ ] Say "yes I'm the owner, sounds good" → transfer bridges to `CLOSER_NUMBER`
- [ ] Let it ring to voicemail → `voicemail-message` plays, call ends
- [ ] Say "take me off your list" → `close-dnc`, and the number appears in the `dnc` table
- [ ] Check `logs/calls/<sid>.json` and the `calls` / `call_turns` rows look right
- [ ] `POST /runner/pause`

## Compliance (before dialing a real list)
- [ ] List scrubbed against federal + state DNC
- [ ] `CALLING_HOUR_START` / `END` correct; lead CSV has real timezones
- [ ] Counsel has reviewed the list + script for TCPA / B2B applicability
- [ ] Per-number daily volume cap plan (rotate numbers as you scale)

## First live batch
- [ ] Start with `MAX_CONCURRENT_CALLS=1`, ~20 leads
- [ ] Watch `logs/calls/` and `/health` counters live
- [ ] Review every transcript; tune `hallucination-denylist.js`, prompts, `classifier-prompt.js`
- [ ] Only then raise concurrency
