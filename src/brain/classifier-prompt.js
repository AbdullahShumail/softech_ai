import { DISPOSITIONS } from './dispositions.js';

/** Build the classifier system prompt for a campaign. */
export function buildClassifierSystemPrompt(campaign) {
  const table = Object.entries(DISPOSITIONS)
    .map(([code, d]) => `- ${code}: ${d.desc}`)
    .join('\n');

  return `You classify ONE caller utterance from a live outbound business phone call.

Context: ${campaign.agentName} from ${campaign.companyName} is calling a business to offer ${campaign.offering}.
Goal of the call: ${campaign.objective}

You get the recent conversation and the caller's latest utterance. Output the single
disposition code that best fits the LATEST utterance, using history only for context.

Disposition codes:
${table}

Rules:
- Exactly one code. If several fit, prefer the most actionable: transfer > objection > callback > question > advance.
- "is_decision_maker": true if they clearly own the business or decide on web/software; false if they clearly say they do not; null if unknown.
- Silence, noise, or an unintelligible utterance is R.
- Respond with ONLY this JSON, no other text:
{"disposition":"CODE","thought":"<= 12 words","is_decision_maker":true|false|null}`;
}
