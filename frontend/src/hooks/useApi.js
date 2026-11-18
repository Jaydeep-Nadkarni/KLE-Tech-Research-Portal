import { useEffect, useState, useCallback, useRef } from 'react';
import { api, errMsg } from '../api/client';

/** GET helper with loading/error state. Pass null url to skip. Refetches when url changes. */
export function useApi(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const id = ++seq.current;
    setLoading(true); setError(null);
    try {
      const r = await api.get(url);
      if (id === seq.current) setData(r.data);
    } catch (e) {
      if (id === seq.current) setError(errMsg(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
