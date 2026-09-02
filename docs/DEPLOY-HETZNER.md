# Deploy — Hetzner + Caddy + PM2

Target: one small VM (CX22 / 2 vCPU / 4 GB is plenty for Phase 1), Debian 12.

## 0. DNS

Point a subdomain at the VM's public IPv4:

```
bot.yourdomain.com.   A   <VM_IPV4>
```

Twilio connects **inbound** to `wss://bot.yourdomain.com/media`, so this must
resolve publicly and 443 must be open.

## 1. Base packages

```bash
sudo apt update && sudo apt install -y curl git ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

## 2. Caddy (TLS termination)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Edit `/etc/caddy/Caddyfile` — use `deploy/Caddyfile` from this repo, with your real
hostname — then:

```bash
sudo systemctl reload caddy
```

## 3. App

```bash
git clone https://github.com/AbdullahShumail/softech_ai.git
cd softech_ai
npm ci
cp .env.example .env && nano .env      # fill Twilio + Groq + PUBLIC_HOST + CLOSER_NUMBER + CONTROL_TOKEN
npm run migrate
npm test                               # sanity
```

Put prompt WAVs in `prompts/b2b-outreach/` (see `docs/PROMPTS.md`).

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup            # run the command it prints
pm2 install pm2-logrotate      # rotates logs/out.log + logs/err.log
```

`.env` essentials on the box:

```
PUBLIC_HOST=bot.yourdomain.com
HTTP_PORT=8080
NODE_ENV=production
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...
GROQ_API_KEY=...
CLOSER_NUMBER=+1...
CONTROL_TOKEN=<random string>
RUNNER_AUTOSTART=false
```

## 4. Verify

```bash
curl https://bot.yourdomain.com/health          # {ok:true,...}
```

Then the step-3 transport check: buy a Twilio number, set its Voice webhook (or an
API call's `url`) to `https://bot.yourdomain.com/voice`, place a test call.

## 5. Dialing

```bash
node scripts/import-leads.mjs leads.csv
curl -X POST https://bot.yourdomain.com/runner/start -H "X-Control-Token: $CONTROL_TOKEN"
curl -X POST https://bot.yourdomain.com/runner/pause -H "X-Control-Token: $CONTROL_TOKEN"
```

## Updating

```bash
git pull && npm ci && npm run migrate && pm2 reload b2b-outreach-bot
```

`kill_timeout` in the PM2 config lets in-flight calls drain on reload.
