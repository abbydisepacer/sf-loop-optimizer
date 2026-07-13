"use client";

import { usePersistedValue } from "./use-persisted-value";
import { DEFAULT_TIMEZONE } from "./timezones";

/**
 * A manually-picked timezone persisted per storageKey (e.g. per wholesaler)
 * — Graph has no reliable way to look up a DIFFERENT mailbox's timezone
 * (MailboxSettings.Read is delegated-only for your own mailbox), so the
 * internal/admin viewer picks it once and it's remembered per wholesaler.
 */
export function usePersistedTimezone(storageKey: string): [string, (tz: string) => void] {
  return usePersistedValue(storageKey, DEFAULT_TIMEZONE);
}
