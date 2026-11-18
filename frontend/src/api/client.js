import axios from 'axios';

export const api = axios.create({ baseURL: '/api', withCredentials: true });

export const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';

// Redirect to login when the session expires (but not for the login call itself)
api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401 && !e.config.url.includes('/auth/login') && !e.config.url.includes('/auth/me')) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    return Promise.reject(e);
  }
);

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => { if (v !== '' && v != null) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
