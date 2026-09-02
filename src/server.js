import { createServer } from 'node:http';
import { config, assertRuntimeConfig } from './config.js';
import { logger } from './obs/logger.js';
import { counters } from './obs/health.js';
import './data/db.js'; // opens DB + runs idempotent migrations
import { startCall, recordTurn, finalizeCall, markDnc } from './data/call-repo.js';
import { CallLog } from './obs/call-log.js';
import { createHttpApp } from './telephony/twiml-http.js';
import { attachMediaStream } from './telephony/media-stream.js';
import { transferToCloser, hangup } from './telephony/twilio-rest.js';
import { PromptLibrary } from './audio/prompt-library.js';
import { loadCampaign } from './brain/campaign.js';
import { allPromptNames } from './brain/audio-map.js';
import { CallSession } from './call/session.js';

assertRuntimeConfig();

const campaign = loadCampaign();
const library = new PromptLibrary();
try {
  library.loadDir(config.prompts.dir);
} catch (err) {
  logger.warn({ err: err.message }, 'no prompts loaded — calls will play nothing until prompts exist');
}
const missing = allPromptNames().filter((n) => !library.has(n));
if (missing.length) logger.warn({ missing }, 'prompt files referenced by audio-map are missing');

const app = createHttpApp();
const server = createServer(app);

attachMediaStream(server, (stream) => {
  const callSid = stream.callSid;
  const leadId = stream.customParameters?.leadId ?? null;
  const phone = stream.customParameters?.phone ?? null;

  const callId = startCall(callSid, leadId);
  const log = new CallLog(config.logs.callDir, callSid);
  log.event('answered', { leadId, phone });
  counters.callsStarted++;
  counters.callsAnswered++;

  const startedAt = Date.now();
  const session = new CallSession({
    stream,
    library,
    campaign,
    callSid,
    deps: {
      log,
      repo: { recordTurn },
      callId,
      transfer: transferToCloser,
      hangup,
      onFinal: (summary) => {
        const durationS = Math.round((Date.now() - startedAt) / 1000);
        finalizeCall(callSid, { answered: true, durationS, ...summary });
        if (summary.finalDisposition === 'DNC' && phone) markDnc(phone);
        if (summary.transferred) counters.transfers++;
        counters.callsCompleted++;
        logger.info({ callSid, ...summary, durationS }, 'call finished');
      },
    },
  });

  stream.log.info('call session starting');
  session.start().catch((err) => logger.error({ callSid, err: err.message }, 'session.start failed'));
});

server.listen(config.http.port, () => {
  logger.info(
    { port: config.http.port, publicHost: config.http.publicHost, campaign: campaign.campaign, env: config.env },
    'b2b-outreach-bot listening',
  );
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logger.info({ sig }, 'shutting down');
    server.close(() => process.exit(0));
  });
}
