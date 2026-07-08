"use client";

import { useState } from "react";
import { DEFAULT_TIMEZONE } from "./timezones";

function readStored(key: string): string {
  if (typeof window === "undefined") return DEFAULT_TIMEZONE;
  return window.localStorage.getItem(key) || DEFAULT_TIMEZONE;
}

/**
 * A manually-picked timezone persisted per storageKey (e.g. per wholesaler)
 * — Graph has no reliable way to look up a DIFFERENT mailbox's timezone
 * (MailboxSettings.Read is delegated-only for your own mailbox), so the
 * internal/admin viewer picks it once and it's remembered per wholesaler.
 * Keying off storageKey and resetting during render (not an effect) mirrors
 * the pattern used by useOutlookLoop/useRealDriveTimes — switching to a
 * different wholesaler immediately restores THEIR last-picked zone instead
 * of carrying over the previous one.
 */
export function usePersistedTimezone(storageKey: string): [string, (tz: string) => void] {
  const [trackedKey, setTrackedKey] = useState(storageKey);
  const [timeZone, setTimeZone] = useState(() => readStored(storageKey));

  if (storageKey !== trackedKey) {
    setTrackedKey(storageKey);
    setTimeZone(readStored(storageKey));
  }

  const update = (tz: string) => {
    setTimeZone(tz);
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, tz);
  };

  return [timeZone, update];
}
