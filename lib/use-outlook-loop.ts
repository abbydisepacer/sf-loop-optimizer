"use client";

import { useEffect, useState } from "react";
import type { LoopStop } from "./types";

export type PreExistingEvent = {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string;
};

type CalendarApiResult = {
  stops?: LoopStop[];
  preExisting?: PreExistingEvent[];
  connected?: boolean;
  error?: string;
};

type OutlookLoopState = {
  stops: LoopStop[];
  preExisting: PreExistingEvent[];
  /** False means Outlook was never connected for this kind of access — show a "Connect Outlook" prompt, not an empty-day state. */
  connected: boolean;
  loading: boolean;
};

/**
 * Fetches a wholesaler's Outlook-backed loop for one date via
 * /api/microsoft/calendar. Omit `target` when the caller wants their OWN
 * calendar (the external role's own view — the API route resolves the
 * wholesaler/email from the caller's own session). Pass `target` when an
 * internal/admin is reading someone else's shared calendar — `timeZone` is
 * required there since Graph can't look up a different mailbox's timezone
 * (see lib/microsoft/calendar.ts), so the internal wholesaler picks it
 * manually in the UI.
 */
export function useOutlookLoop(
  date: string,
  target?: { wholesalerId: string; email: string; timeZone: string }
): OutlookLoopState {
  const key = `${date}|${target?.wholesalerId ?? ""}|${target?.email ?? ""}|${target?.timeZone ?? ""}`;
  const [trackedKey, setTrackedKey] = useState(key);
  const [state, setState] = useState<Omit<OutlookLoopState, "loading">>({
    stops: [],
    preExisting: [],
    // Assume connected until the first fetch resolves, so the UI doesn't
    // flash a "Connect Outlook" prompt before it knows either way.
    connected: true,
  });
  const [loading, setLoading] = useState(true);

  // Reset to "loading" the instant the query key changes, during render
  // rather than in an effect — same pattern useRealDriveTimes uses, and
  // the one React recommends for this ("adjusting state when a prop
  // changes"), which also sidesteps the set-state-in-effect lint rule.
  if (key !== trackedKey) {
    setTrackedKey(key);
    setLoading(true);
  }

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams({ date });
    if (target) {
      params.set("wholesalerId", target.wholesalerId);
      params.set("email", target.email);
      params.set("timeZone", target.timeZone);
    } else {
      // Reading your OWN calendar: the external role's token no longer has
      // MailboxSettings.Read (narrowed to least-privilege Calendars.Read),
      // so there's no Graph lookup for "your own timezone" anymore. Your
      // own browser's timezone is a reliable stand-in, since you're
      // presumably viewing your own schedule from your own device.
      params.set("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone);
    }

    fetch(`/api/microsoft/calendar?${params}`)
      .then((res) => res.json())
      .then((data: CalendarApiResult) => {
        if (cancelled) return;
        setState({
          stops: data.stops ?? [],
          preExisting: data.preExisting ?? [],
          connected: data.connected ?? false,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Failed to fetch Outlook calendar:", err);
        setState({ stops: [], preExisting: [], connected: false });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures date+target already
  }, [key]);

  return { ...state, loading };
}
