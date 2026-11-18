import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

if (!env.jwtSecret || env.jwtSecret.length < 32) {
  logger.fatal('JWT_SECRET is missing or too short. Run: node src/scripts/seedUsers.js (generates one) or set it in .env');
  process.exit(1);
}
await connectDb();
createApp().listen(env.port, () => logger.info({ port: env.port }, 'API listening'));
