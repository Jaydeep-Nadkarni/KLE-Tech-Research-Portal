import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.logLevel,
  redact: ['req.headers.authorization', '*.apiKey', '*.X-ELS-APIKey', '*.headers["X-ELS-APIKey"]'],
});
