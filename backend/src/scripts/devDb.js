// Dev-only: runs a persistent local mongod via mongodb-memory-server so no install is needed.
// Production uses MONGODB_URI. Data persists in backend/.devdb between runs.
import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

const dbPath = path.join(env.root, '.devdb');
fs.mkdirSync(dbPath, { recursive: true });
const m = await MongoMemoryServer.create({ instance: { port: 27017, dbPath, storageEngine: 'wiredTiger' } });
console.log(`dev mongod ready: ${m.getUri()}kle_research_portal`);
process.on('SIGINT', async () => { await m.stop({ doCleanup: false }); process.exit(0); });
setInterval(() => {}, 1 << 30);
