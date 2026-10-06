import { useEffect, useState } from 'react';
import { api } from '../api';

// Small cache for settings lists used across many forms.
const cache: Record<string, Promise<any>> = {};
const listeners = new Set<() => void>();

export function invalidateLookups(key?: string) {
  if (key) delete cache[key]; else for (const k of Object.keys(cache)) delete cache[k];
  listeners.forEach((fn) => fn());
}

const SOURCES = {
  taxes: '/settings/taxes',
  warehouses: '/settings/warehouses',
  units: '/settings/units',
  carriers: '/settings/carriers',
  organization: '/settings/organization',
};

async function load(key) {
  if (!cache[key]) cache[key] = api.get(SOURCES[key]).catch((err) => { delete cache[key]; throw err; });
  return cache[key];
}

/** useLookups('taxes', 'warehouses') -> { taxes: [...], warehouses: [...] } (empty arrays while loading) */
export function useLookups(...keys) {
  const [data, setData] = useState(() => Object.fromEntries(keys.map((k) => [k, k === 'organization' ? null : []])));
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const fn = () => setVersion((v) => v + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  useEffect(() => {
    let alive = true;
    Promise.all(keys.map((k) => load(k).catch(() => (k === 'organization' ? null : []))))
      .then((vals) => { if (alive) setData(Object.fromEntries(keys.map((k, i) => [k, vals[i]]))); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, keys.join(',')]);
  return data;
}
