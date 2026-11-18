import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export async function connectDb(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  logger.info({ db: mongoose.connection.name }, 'mongodb connected');
}
export const disconnectDb = () => mongoose.disconnect();
