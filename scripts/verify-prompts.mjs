// Load every prompt exactly as the bot does at boot and report duration/format.
//   node scripts/verify-prompts.mjs
import 'dotenv/config';
import { PromptLibrary } from '../src/audio/prompt-library.js';
import { allPromptNames } from '../src/brain/audio-map.js';
import { config } from '../src/config.js';

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
console.log(`\n${required.length - missing.length}/${required.length} present · ${(total / 1000).toFixed(0)}s of audio total`);
console.log(missing.length ? `MISSING: ${missing.join(', ')}` : 'all prompts load ✓');
process.exit(missing.length ? 1 : 0);
