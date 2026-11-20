/**
 * Data fetching hook with an in-memory cache and "keep previous data" semantics:
 * when the URL changes (filters, tabs), the previous data stays on screen until
 * the new response arrives → no blank flashes, no layout jumps.
 */

import { useEffect, useRef, useState } from "react";
import { apiGet } from "../api/client";

const cache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const TTL_MS = 5 * 60_000;

export function invalidateApiCache(prefix?: string) {
  if (!prefix) cache.clear();
  else for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

function fetchCached<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data as T);
  const running = inflight.get(url);
  if (running) return running as Promise<T>;
  const p = apiGet<T>(url)
    .then((data) => {
      cache.set(url, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useApi<T = any>(url: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(() => {
    if (!url) return null;
    const hit = cache.get(url);
    return hit ? (hit.data as T) : null;
  });
  const [loading, setLoading] = useState<boolean>(Boolean(url) && !(url && cache.has(url)));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    let alive = true;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < TTL_MS && nonce === 0) {
      setData(hit.data as T);
      setLoading(false);
      setError(null);
      return;
    }
    if (nonce > 0) cache.delete(url);
    setLoading(true);
    fetchCached<T>(url)
      .then((d) => {
        if (!alive || urlRef.current !== url) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message || "Erreur réseau");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

/** Appends a path to a query string produced by buildQueryParams. */
export function withQs(path: string, qs: string, extra?: Record<string, string | number>): string {
  const params = new URLSearchParams(qs.startsWith("?") ? qs.slice(1) : qs);
  if (extra) for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}
