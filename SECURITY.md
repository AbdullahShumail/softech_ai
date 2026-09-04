# Secrets & credentials

## Where secrets live

| Where | What | Notes |
|---|---|---|
| `/opt/softai/.env` on the droplet | all live credentials | `chmod 600`, owned by root, **never** in git |
| `.env.example` (committed) | key names only, no values | the template |
| this repo | **nothing secret** | verified by `npm run audit:secrets` |

`src/config.js` is the only file that reads `process.env`. Nothing else should
touch a credential directly.

## Guards in place

- **`.gitignore`** covers `.env`, `.env.*`, `*.pem`, `*.key`, `secrets/`
- **pre-commit hook** (`.githooks/pre-commit`) blocks any staged `.env` or any
  diff containing a Groq / Twilio / OpenAI key or a private-key block.
  Installed automatically by `npm install` (`prepare` sets `core.hooksPath`).
  After a fresh clone, `git config core.hooksPath .githooks` if you skipped install.
- **`npm run audit:secrets`** checks the working tree *and every blob in git
  history*, plus that the hook is active. Run it before any push you are unsure of.

## Rotating

Do this whenever a value has been pasted into a chat, a ticket, or a screenshot.

| Credential | Where to rotate |
|---|---|
| **Groq API key** | console.groq.com → API Keys → create new, delete old |
| **Twilio Auth Token** | Console → Account → API keys & tokens → Auth Tokens → create secondary, promote, delete primary (zero downtime) |
| **Twilio API Key** (browser calling) | Console → Account → API keys & tokens → delete `softai-voice-browser`, create a new Standard key |
| **CONTROL_TOKEN** | any random string; `sed -i` it into `/opt/softai/.env` and `pm2 restart` |

After changing any of them:

```bash
ssh -p 2222 root@<droplet-ip>
cd /opt/softai && nano .env && pm2 restart b2b-outreach-bot
curl -s https://softai.askforit.io/health
```

## The CONTROL_TOKEN

Gates `/call`, `/logs`, `/token` and `/runner*`. It matters because `/token`
mints Twilio Access Tokens — anyone holding it can place calls billed to the
account. It travels as a `?k=` query parameter, so treat those URLs as secrets:
they land in browser history and, if you ever put the bot behind a proxy that
logs full URLs, in those logs too.

## Not in scope

Twilio signature validation (`TWILIO_VALIDATE_SIGNATURES=true`) protects the
`/voice` and `/status` webhooks from forged requests. That is separate from
credential hygiene and is already on — verified by a signed/unsigned request pair.
