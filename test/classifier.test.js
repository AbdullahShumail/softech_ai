import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/brain/classifier.js';
import { buildClassifierSystemPrompt } from '../src/brain/classifier-prompt.js';
import { loadCampaign } from '../src/brain/campaign.js';
import { DISPOSITION_CODES } from '../src/brain/dispositions.js';

const campaign = loadCampaign('b2b-outreach');
const sys = buildClassifierSystemPrompt(campaign);

function fakeClient(content) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content } }],
          usage: { total_tokens: 42 },
        }),
      },
    },
  };
}

test('system prompt embeds campaign identity and the code table', () => {
  // assert against the config, not a literal — the company name is allowed to change
  assert.ok(sys.includes(campaign.companyName), 'company name missing from prompt');
  assert.ok(sys.includes(campaign.agentName), 'agent name missing from prompt');
  assert.match(sys, /- QUAL:/);
  assert.match(sys, /- DNC:/);
});

test('every disposition code reaches the classifier prompt', () => {
  // a code the model is never told about can never be returned
  for (const code of DISPOSITION_CODES) {
    assert.ok(sys.includes(`- ${code}:`), `${code} missing from the prompt's code table`);
  }
});

test('parses a well-formed classifier response', async () => {
  const r = await classify({
    systemPrompt: sys,
    utterance: "yeah I own the place, what are you offering",
    client: fakeClient('{"disposition":"QUAL","thought":"owner, engaged","is_decision_maker":true}'),
  });
  assert.equal(r.disposition, 'QUAL');
  assert.equal(r.decisionMaker, true);
  assert.equal(r.tokens, 42);
});

test('an unknown disposition code falls back to R', async () => {
  const r = await classify({
    systemPrompt: sys,
    utterance: 'blah',
    client: fakeClient('{"disposition":"BANANA","thought":"?","is_decision_maker":null}'),
  });
  assert.equal(r.disposition, 'R');
});

test('non-boolean is_decision_maker becomes null', async () => {
  const r = await classify({
    systemPrompt: sys,
    utterance: 'maybe',
    client: fakeClient('{"disposition":"NEU","thought":"noncommittal","is_decision_maker":"maybe"}'),
  });
  assert.equal(r.decisionMaker, null);
});

test('malformed JSON from the model degrades to R, not a throw', async () => {
  const r = await classify({
    systemPrompt: sys,
    utterance: 'x',
    client: fakeClient('not json at all'),
  });
  assert.equal(r.disposition, 'R');
});
