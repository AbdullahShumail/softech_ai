// Load every prompt exactly as the bot does at boot and report duration/format.
//   node scripts/verify-prompts.mjs
import 'dotenv/config';
import { PromptLibrary } from '../src/audio/prompt-library.js';
import { allPromptNames, ACK_PROMPTS } from '../src/brain/audio-map.js';
import { config } from '../src/config.js';

// Must match MAX_ACK_MS in src/call/session.js. An ack longer than this is
// skipped at runtime, so a regeneration that lets one drift over the line
// silently drops it from the rotation instead of failing loudly.
const MAX_ACK_MS = 600;

const lib = new PromptLibrary();
lib.loadDir(config.prompts.dir);

const required = allPromptNames();
let total = 0;
for (const n of required) {
  const ms = lib.durationMs(n);
  total += ms;
  const flag = !lib.has(n) ? 'MISSING' : ms > 20000 ? 'long' : ms < 700 ? 'very short' : '';
  console.log(`  ${n.padEnd(22)} ${(ms / 1000).toFixed(1).padStart(6)}s  ${flag}`);
}
const missing = required.filter((n) => !lib.has(n));
console.log(
  `\n${required.length - missing.length}/${required.length} present · ${(total / 1000).toFixed(0)}s of audio total`,
);

// Acks exist to hide a ~650 ms classifier wait. One that outlasts the wait would
// make the turn slower, so the session refuses to play it.
const slowAcks = ACK_PROMPTS.filter((n) => lib.has(n) && lib.durationMs(n) > MAX_ACK_MS);
if (slowAcks.length) {
  const detail = slowAcks.map((n) => `${n} (${Math.round(lib.durationMs(n))}ms)`).join(', ');
  console.log(`\nACKS TOO LONG (> ${MAX_ACK_MS}ms, will be skipped at runtime): ${detail}`);
  console.log('  → shorten the copy in tools/prompt-script.json and regenerate those clips.');
} else {
  console.log(`all ${ACK_PROMPTS.length} acks under ${MAX_ACK_MS}ms ✓`);
}

console.log(missing.length ? `MISSING: ${missing.join(', ')}` : 'all prompts load ✓');
process.exit(missing.length || slowAcks.length ? 1 : 0);
