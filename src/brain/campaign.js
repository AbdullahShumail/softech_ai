import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

/** Load campaigns/<name>/config.json. Throws if missing or malformed. */
export function loadCampaign(name = config.campaign.name) {
  const path = join('campaigns', name, 'config.json');
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`campaign "${name}" not loadable (${path}): ${err.message}`);
  }
  for (const k of ['agentName', 'companyName', 'offering', 'objective', 'turnLogic']) {
    if (!cfg[k]) throw new Error(`campaign "${name}" missing "${k}"`);
  }
  return cfg;
}
