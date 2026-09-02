// CLI: `npm run migrate` — applies schema.sql (idempotent) and exits.
import { migrate } from './db.js';
import { logger } from '../obs/logger.js';

migrate();
logger.info('migrations applied');
process.exit(0);
