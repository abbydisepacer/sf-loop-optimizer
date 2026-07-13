"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notify(): void {
  listeners.forEach((callback) => callback());
}

/**
 * A string persisted to localStorage under `storageKey`, safe across SSR
 * and hydration. `useState(() => localStorage.getItem(...))` looks
 * reasonable but isn't: React re-invokes that initializer during the
 * client's hydration render (where `window` exists), producing a different
 * value than the server rendered with (no `window`) — a real hydration
 * mismatch, not just a lint nitpick. useSyncExternalStore is React's
 * purpose-built fix: `getServerSnapshot` matches what the server sent for
 * both the server render AND the client's hydration pass, and it swaps to
 * the real client value immediately after, without an error.
 */
export function usePersistedValue(storageKey: string, fallback: string): [string, (value: string) => void] {
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return fallback;
    return window.localStorage.getItem(storageKey) ?? fallback;
  }, [storageKey, fallback]);

  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: string) => {
      if (typeof window !== "undefined") window.localStorage.setItem(storageKey, next);
      notify();
    },
    [storageKey]
  );

  return [value, setValue];
}
