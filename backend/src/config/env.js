import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const str = (k, d = '') => (process.env[k] ?? d).trim();

export const env = {
  root,
  nodeEnv: str('NODE_ENV', 'development'),
  mongoUri: str('MONGODB_URI', 'mongodb://127.0.0.1:27017/kle_research_portal'),
  port: Number(str('PORT', '4000')),
  jwtSecret: str('JWT_SECRET'),
  corsOrigin: str('CORS_ORIGIN', 'http://localhost:5173').split(',').map((s) => s.trim()),
  logLevel: str('LOG_LEVEL', 'info'),
  elsevierKey: str('ELSEVIER_API_KEY'),
  elsevierInstToken: str('ELSEVIER_INSTTOKEN'), // optional
  scopusBase: str('SCOPUS_API_BASE_URL', 'https://api.elsevier.com').replace(/\/$/, ''),
  semanticScholarKey: str('SEMANTIC_SCHOLAR_API_KEY'), // optional, raises rate limits
  serpApiKey: str('SERPAPI_API_KEY'), // optional: approved third-party provider for Google Scholar profiles
  clarivateKey: str('CLARIVATE_API_KEY'), // optional: Web of Science Starter API key
  openAlexKey: str('OPENALEX_API_KEY'), // optional
  contactMailto: str('API_CONTACT_MAILTO'), // optional polite-pool address; never defaulted
};
