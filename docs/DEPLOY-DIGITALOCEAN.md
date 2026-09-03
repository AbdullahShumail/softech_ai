# Deploy — DigitalOcean + Caddy + PM2

Target: one $6 droplet. No FreeSWITCH, no SIP, no local ML — Twilio handles all
telephony and hands us audio over a WebSocket, so the box only needs port 443 in.

## 1. Create the droplet

DigitalOcean → Create → Droplets:

| Field | Value |
|---|---|
| Region | **NYC3** (nearest Twilio `us1` edge + Groq's US API) |
| Image | **Debian 12 x64** |
| Type | **Basic** → **Regular (SSD)** |
| Size | **$6/mo — 1 GB / 1 vCPU / 25 GB / 1 TB transfer** |
| Authentication | **SSH key** (add yours; skip password auth) |
| Backups | optional (+20% ≈ $1.20/mo) — the SQLite file is the whole datastore |
| Monitoring | ✅ (free) |
| Hostname | `softai-bot` |

DO assigns the public IPv4 directly to `eth0` — no NAT quirks to work around.

Resize later without rebuilding if you outgrow it (CPU/RAM resize is reversible).

## 2. DNS (Cloudflare, askforit.io zone)

| Type | Name | Content | Proxy | TTL |
|---|---|---|---|---|
| A | `softai` | `<droplet IPv4>` | **DNS only (grey cloud)** | Auto |

Grey cloud matters: Twilio Media Streams is a live WebSocket, and Cloudflare's
proxy buffers, adds a hop, and times WebSockets out at ~100 s. Unproxied also lets
Caddy issue its own Let's Encrypt cert normally.

Also set the droplet's **PTR / reverse DNS** to `softai.askforit.io` (DO → Droplet →
Networking).

## 3. Firewall

Use the DO Cloud Firewall (free) or `ufw` on the box. Inbound allow **only**:

| Port | Proto | Source |
|---|---|---|
| 22 | TCP | your IP (or anywhere if you have no static IP) |
| 80 | TCP | anywhere — ACME/Caddy |
| 443 | TCP | anywhere — Twilio webhooks + Media Streams |

Outbound: allow all. No UDP, no RTP range — Twilio does the SIP/RTP.

```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443
sudo ufw enable
```

## 4. Base packages

```bash
sudo apt update && sudo apt install -y curl git ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3   # build tools for better-sqlite3
sudo npm i -g pm2
node --version    # must be >= 20
```

## 5. Caddy (TLS)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:
```
softai.askforit.io {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}
```
```bash
sudo systemctl reload caddy
```

## 6. App

```bash
cd /opt && sudo git clone https://github.com/AbdullahShumail/softech_ai.git softai
sudo chown -R $USER:$USER /opt/softai && cd /opt/softai
npm ci
cp .env.example .env && nano .env
npm run migrate
npm test              # 55 tests should pass
```

`.env` minimum for a live call:
```
NODE_ENV=production
HTTP_PORT=8080
PUBLIC_HOST=softai.askforit.io
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...
GROQ_API_KEY=gsk_...
CLOSER_NUMBER=+1...            # a phone that rings you, for the transfer test
CONTROL_TOKEN=<random string>
RUNNER_AUTOSTART=false         # keep the outbound dialer OFF for now
```

Generate the prompt audio (uses the same Groq key — no extra credential):
```bash
npm run gen-prompts
```

Start it:
```bash
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup     # run the command it prints
pm2 install pm2-logrotate
```

## 7. Verify

```bash
curl https://softai.askforit.io/health      # {"ok":true,...}
pm2 logs b2b-outreach-bot
```
Boot log must NOT list any missing prompts.

## 8. Wire the Twilio number — inbound test

Twilio Console → Phone Numbers → your number → **Voice & Fax**:

| Setting | Value |
|---|---|
| A call comes in | **Webhook** |
| URL | `https://softai.askforit.io/voice` |
| HTTP method | **POST** |

Save, then **call the number from your phone**. Expected in `pm2 logs`:

1. `served /voice TwiML` — Twilio fetched the TwiML
2. `stream started` — the Media Stream WebSocket connected
3. `call session starting` → greeting plays in your ear
4. Speak → `stt` → `classify` → a disposition → the matching prompt plays back

Then try: *"who is this?"* (→ `ans-who`), *"not interested"* (→ `reb-ni`),
*"yes I'm the owner, sounds good"* (→ transfer to `CLOSER_NUMBER`),
*"take me off your list"* (→ `close-dnc` + hangup).

Every call writes `logs/calls/<CallSid>.json` with the full transcript and
per-turn dispositions — that's what you tune from.

## 9. Outbound (when you're ready)

```bash
node scripts/import-leads.mjs leads.csv
curl -X POST https://softai.askforit.io/runner/start -H "X-Control-Token: $CONTROL_TOKEN"
curl -X POST https://softai.askforit.io/runner/pause -H "X-Control-Token: $CONTROL_TOKEN"
```

## Updating

```bash
cd /opt/softai && git pull && npm ci && npm run migrate && pm2 reload b2b-outreach-bot
```

## Troubleshooting (ranked by likelihood)

1. **`403 invalid signature` on /voice** → `PUBLIC_HOST` must exactly match the host
   Twilio called. Confirm no trailing slash / wrong subdomain. To unblock a demo,
   set `TWILIO_VALIDATE_SIGNATURES=false` temporarily, then turn it back on.
2. **Call connects, silence** → prompts missing. Check the boot log for
   `prompt files referenced by audio-map are missing`, then `npm run gen-prompts`.
3. **`npm run gen-prompts` fails on the model** → Groq's TTS model may need terms
   accepted in the Groq console, or a different id. Try
   `node tools/gen-prompts.mjs --provider openai` (needs `OPENAI_API_KEY`), or
   `--model <id>` / `--voice <name>`.
4. **Stream never starts** → Cloudflare proxy is on. Set the `softai` record to
   **DNS only (grey cloud)**.
5. **`better-sqlite3` fails to build** → missing `build-essential` / `python3`.
   On a 1 GB droplet add swap if the compile OOMs:
   `sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`
6. **Cert not issued** → port 80 must be open and the A record must resolve to the
   droplet before Caddy starts. `sudo journalctl -u caddy -f`.
7. **Bot talks over you / cuts off early** → tune `src/vad/endpointer.js`
   (`endFrames` = trailing silence before it stops listening, default 35 ≈ 700 ms).
