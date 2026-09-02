import pino from 'pino';
import { config } from '../config.js';

const isDev = config.env === 'development';

export const logger = pino({
  level: config.logLevel,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

/** Child logger bound to a call. */
export function callLogger(callSid) {
  return logger.child({ callSid });
}
