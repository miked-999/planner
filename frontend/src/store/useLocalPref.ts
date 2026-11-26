import { useCallback, useEffect, useMemo, useState } from 'react';

const PREFIX = 'planner.pref.';

function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * Per-user view preference persisted in localStorage (sort lens, expanded/hidden projects,
 * tray open state). These never touch the shared plan, so one person's view choices don't
 * change anyone else's. Later, with SSO, this can move to a user profile endpoint.
 */
export function useLocalPref<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback));

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Storage full or disabled — preference simply won't persist.
    }
  }, [key, value]);

  const update = useCallback((next: T | ((prev: T) => T)) => {
    setValue((prev) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next));
  }, []);

  return [value, update];
}

/** Convenience wrapper for a persisted set of ids (stored as an array). */
export function useLocalIdSet(
  key: string,
): [Set<string>, (updater: (prev: Set<string>) => Set<string>) => void] {
  const [ids, setIds] = useLocalPref<string[]>(key, []);
  const set = useMemo(() => new Set(ids), [ids]);
  const update = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setIds((prev) => Array.from(updater(new Set(prev))));
    },
    [setIds],
  );
  return [set, update];
}
