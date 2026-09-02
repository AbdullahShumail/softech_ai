// Manual smoke: boots the app with dummy creds on port 8177, hits the routes.
// Run: npm run smoke   (kept out of test/ so `node --test` doesn't boot a server)
process.env.TWILIO_ACCOUNT_SID ||= 'ACtest';
process.env.TWILIO_AUTH_TOKEN ||= 'tok';
process.env.TWILIO_FROM_NUMBER ||= '+15550000000';
process.env.PUBLIC_HOST ||= 'example.com';
process.env.GROQ_API_KEY ||= 'gsk_test';
process.env.TWILIO_VALIDATE_SIGNATURES = 'false';
process.env.HTTP_PORT = '8177';
process.env.NODE_ENV = 'production';

await import('../src/server.js');
await new Promise((r) => setTimeout(r, 500));

const base = 'http://localhost:8177';
const health = await (await fetch(`${base}/health`)).json();
console.log('GET /health ->', health);

const voice = await fetch(`${base}/voice`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'CallSid=CAsmoke123',
});
console.log('POST /voice ->', voice.status);
console.log(await voice.text());

process.exit(0);
