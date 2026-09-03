// Live sanity check of the classifier against realistic utterances.
//   node scripts/classifier-check.mjs
// Needs GROQ_API_KEY in .env. Costs a fraction of a cent.
import 'dotenv/config';
import { classify } from '../src/brain/classifier.js';
import { buildClassifierSystemPrompt } from '../src/brain/classifier-prompt.js';
import { loadCampaign } from '../src/brain/campaign.js';
import { config } from '../src/config.js';

const sys = buildClassifierSystemPrompt(loadCampaign());
const cases = [
  ["yeah I own the shop, what's this about", 'DM/QUAL/NEU'],
  ['not interested, thanks', 'NI'],
  ["take me off your list and don't call again", 'DNC'],
  ['we already have a guy who does our website', 'HAS'],
  ['how much does something like that cost', 'BUDGET/HOW/INT'],
  ['are you a robot?', 'BOT'],
  ['who is this?', 'WHO'],
  ["can you call me back tomorrow, I'm driving", 'CB/TIME'],
  ['hold on one second', 'WAIT'],
  ["I'm not the one who handles that, that's our manager", 'NDM'],
  ['yeah that sounds interesting, tell me more', 'INT'],
  ['please leave a message after the tone', 'AM'],
  ['our site is fine the way it is', 'HAP'],
];

console.log(`model=${config.groq.llmModel} effort=${config.groq.reasoningEffort} maxTokens=${config.groq.classifierMaxTokens}\n`);
let total = 0;
for (const [utterance, expect] of cases) {
  const r = await classify({ systemPrompt: sys, utterance });
  total += r.ms;
  console.log(
    `${String(r.disposition).padEnd(7)} dm=${String(r.decisionMaker).padEnd(5)} ${String(r.ms + 'ms').padEnd(7)} exp=${expect.padEnd(16)} "${utterance}"`,
  );
}
console.log(`\navg latency ${Math.round(total / cases.length)}ms over ${cases.length} calls`);
