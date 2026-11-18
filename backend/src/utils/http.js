import axios from 'axios';
import { logger } from './logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ProviderError extends Error {
  constructor(provider, status, kind, message) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.kind = kind; // auth | entitlement | not_found | rate_limited | server | bad_request | network
  }
}

const kindOf = (s) =>
  s === 0 ? 'network' : s === 401 ? 'auth' : s === 403 ? 'entitlement' : s === 404 ? 'not_found'
  : s === 429 ? 'rate_limited' : s >= 500 ? 'server' : 'bad_request';

/**
 * Create a provider HTTP client: min-interval throttling, exponential backoff on
 * 429/5xx/network, Retry-After honoured, every failure logged. Never returns fake data.
 */
export function createClient({ provider, baseURL, headers = {}, minIntervalMs = 200, maxRetries = 4, timeout = 30000 }) {
  const ax = axios.create({ baseURL, headers, timeout, validateStatus: () => true });
  let last = 0;
  let chain = Promise.resolve();

  const throttle = () => {
    chain = chain.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    return chain;
  };

  async function request(config) {
    for (let attempt = 0; ; attempt++) {
      await throttle();
      let res;
      try {
        res = await ax.request(config);
      } catch (e) {
        res = { status: 0, data: e.message, headers: {} };
      }
      if (res.status >= 200 && res.status < 300) return res;
      const retryable = res.status === 0 || res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxRetries) {
        const ra = Number(res.headers?.['retry-after']);
        const wait = ra > 0 ? ra * 1000 : Math.min(30000, 1000 * 2 ** attempt);
        logger.warn({ provider, status: res.status, attempt, wait, url: config.url }, 'provider call failed, retrying');
        await sleep(wait);
        continue;
      }
      const msg = typeof res.data === 'string' ? res.data : res.data?.message || res.headers?.['x-els-status'] || JSON.stringify(res.data)?.slice(0, 300);
      logger.error({ provider, status: res.status, url: config.url, msg }, 'provider call failed');
      throw new ProviderError(provider, res.status, kindOf(res.status), `${provider} HTTP ${res.status}: ${msg}`);
    }
  }
  return { get: (url, params, extra = {}) => request({ method: 'GET', url, params, ...extra }), post: (url, data, params) => request({ method: 'POST', url, data, params }) };
}
