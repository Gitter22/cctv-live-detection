import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env().LOG_LEVEL,
  // Never log credentials, even by accident.
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.passwordEnc', '*.token'],
    censor: '[redacted]',
  },
});
