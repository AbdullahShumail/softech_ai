// Generate the prompt WAV library from tools/prompt-script.json.
//
//   node tools/gen-prompts.mjs                      # Groq TTS (reuses GROQ_API_KEY)
//   node tools/gen-prompts.mjs --provider openai    # OpenAI TTS (needs OPENAI_API_KEY)
//   node tools/gen-prompts.mjs --voice Celeste-PlayAI
//   node tools/gen-prompts.mjs --only greeting,pitch --force
//
// Output lands in PROMPT_DIR (default prompts/b2b-outreach/). Each file is
// verified by running it through the same WAV->mu-law path the bot uses at boot.
import 'dotenv/config';
import OpenAI from 'openai';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { wavToMulaw8k } from '../src/audio/wav.js';
import { allPromptNames } from '../src/brain/audio-map.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const provider = flag('provider', 'groq');
const force = has('force');
const only = flag('only');
const outDir = flag('out', process.env.PROMPT_DIR || './prompts/b2b-outreach');

const PRESETS = {
  groq: {
    model: 'canopylabs/orpheus-v1-english',
    voice: 'tara',
    baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    key: process.env.GROQ_API_KEY,
    keyName: 'GROQ_API_KEY',
  },
  openai: {
    model: 'gpt-4o-mini-tts',
    voice: 'ash',
    baseURL: undefined,
    key: process.env.OPENAI_API_KEY,
    keyName: 'OPENAI_API_KEY',
  },
};

const preset = PRESETS[provider];
if (!preset) {
  console.error(`unknown --provider "${provider}" (use: ${Object.keys(PRESETS).join(', ')})`);
  process.exit(1);
}
if (!preset.key) {
  console.error(`missing ${preset.keyName} — put it in .env`);
  process.exit(1);
}

const model = flag('model', preset.model);
const voice = flag('voice', preset.voice);
const client = new OpenAI({ apiKey: preset.key, baseURL: preset.baseURL });

const script = JSON.parse(readFileSync(new URL('./prompt-script.json', import.meta.url), 'utf8'));
const wanted = only
  ? only.split(',').map((s) => s.trim())
  : Object.keys(script).filter((k) => !k.startsWith('_'));

// Warn about drift between the script file and what the bot actually asks for.
const required = allPromptNames();
const missingFromScript = required.filter((n) => !(n in script));
const extraInScript = Object.keys(script).filter((k) => !k.startsWith('_') && !required.includes(k));
if (missingFromScript.length) console.warn(`! audio-map wants but script lacks: ${missingFromScript.join(', ')}`);
if (extraInScript.length) console.warn(`! script has but audio-map never plays: ${extraInScript.join(', ')}`);

mkdirSync(outDir, { recursive: true });
console.log(`provider=${provider} model=${model} voice=${voice} -> ${outDir}\n`);

let made = 0;
let skipped = 0;
let failed = 0;

for (const name of wanted) {
  const text = script[name];
  if (!text) {
    console.error(`  ${name.padEnd(22)} SKIP  (no text in prompt-script.json)`);
    failed++;
    continue;
  }
  const path = join(outDir, `${name}.wav`);
  if (existsSync(path) && !force) {
    console.log(`  ${name.padEnd(22)} skip  (exists — use --force to regenerate)`);
    skipped++;
    continue;
  }
  try {
    const res = await client.audio.speech.create({
      model,
      voice,
      input: text,
      response_format: 'wav',
    });
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(path, buf);
    const mulaw = wavToMulaw8k(buf); // verify it parses + converts like the bot will
    console.log(`  ${name.padEnd(22)} ok    ${(mulaw.length / 8000).toFixed(1)}s  ${(buf.length / 1024).toFixed(0)}KB`);
    made++;
  } catch (err) {
    console.error(`  ${name.padEnd(22)} FAIL  ${err.message}`);
    failed++;
  }
}

console.log(`\ngenerated ${made}, skipped ${skipped}, failed ${failed}`);
const stillMissing = required.filter((n) => !existsSync(join(outDir, `${n}.wav`)));
console.log(stillMissing.length ? `still missing: ${stillMissing.join(', ')}` : 'all 22 prompts present ✓');
process.exit(failed ? 1 : 0);
