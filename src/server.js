import { createServer } from 'node:http';
import { config, assertRuntimeConfig } from './config.js';
import { logger } from './obs/logger.js';
import './data/db.js'; // opens DB + runs idempotent migrations
import { createHttpApp } from './telephony/twiml-http.js';
import { attachMediaStream } from './telephony/media-stream.js';

assertRuntimeConfig();

const app = createHttpApp();
const server = createServer(app);

attachMediaStream(server, (session) => {
  // Step 3: no runtime yet. `MEDIA_ECHO=true` loops the caller's audio back
  // so we can confirm bidirectional transport on a real call.
  session.log.info('media session ready (no runtime wired yet)');
});

server.listen(config.http.port, () => {
  logger.info(
    { port: config.http.port, publicHost: config.http.publicHost, env: config.env },
    'b2b-outreach-bot listening',
  );
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logger.info({ sig }, 'shutting down');
    server.close(() => process.exit(0));
  });
}
