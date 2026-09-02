import { createServer } from 'node:http';
import { config, assertRuntimeConfig } from './config.js';
import { logger } from './obs/logger.js';
import './data/db.js'; // opens DB + runs idempotent migrations
import { createHttpApp } from './telephony/twiml-http.js';
import { attachMediaStream } from './telephony/media-stream.js';
import { PromptLibrary } from './audio/prompt-library.js';
import { Playback } from './audio/playback.js';

assertRuntimeConfig();

const library = new PromptLibrary();
try {
  library.loadDir(config.prompts.dir);
} catch (err) {
  logger.warn({ err: err.message }, 'no prompts loaded — playback will be a no-op until prompts exist');
}

const app = createHttpApp();
const server = createServer(app);

attachMediaStream(server, (session) => {
  // Step 4: playback is wired; no turn engine yet. With prompts present you can
  // drive session.playback.play(['greeting']) from a REPL / debug hook.
  session.playback = new Playback(session, library);
  session.onMark = (name) => session.playback.onMark(name);
  session.log.info({ prompts: library.size }, 'media session ready (playback wired)');
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
