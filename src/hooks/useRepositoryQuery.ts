'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal async query hook for repository reads.
 *
 * Deliberately not a data-fetching library: every read is local IndexedDB, so
 * there is no network to cache, dedupe or retry. What is actually needed is
 * loading state, error state, out-of-order-response protection, and a manual
 * refresh after a mutation — which is all this provides.
 *
 * `query` must be memoised with `useCallback`; its identity IS the dependency
 * list. That is stricter than passing a separate `deps` array, and it removes
 * the class of bug where the deps and the closure drift apart.
 */
export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

interface InternalState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useRepositoryQuery<T>(query: () => Promise<T>): QueryState<T> {
  const [state, setState] = useState<InternalState<T>>({
    data: null,
    loading: true,
    error: null,
  });
  const [nonce, setNonce] = useState(0);

  // Monotonic request id: a slow earlier query must never overwrite the result
  // of a later one, which is trivially reproducible by typing in a search box.
  const requestId = useRef(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;

    // Note the absence of a synchronous `setLoading(true)` here: it would
    // cascade an extra render on every dependency change. Instead `loading` is
    // set alongside the result, and consumers treat "no data yet" as loading.
    query()
      .then((result) => {
        if (cancelled || id !== requestId.current) return;
        setState({ data: result, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setState({
          data: null,
          loading: false,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [query, nonce]);

  return { ...state, refresh };
}

/**
 * Debounces a rapidly-changing value — search input in particular, where
 * querying on every keystroke means a full store scan per character.
 */
export function useDebounced<T>(value: T, delayMs = 220): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
}
