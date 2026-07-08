"use client";

import { useMemo, useState } from "react";
import { buildLoop } from "@/lib/routing-engine";
import { useRealDriveTimes } from "@/lib/use-real-drive-times";
import { useOutlookLoop, type PreExistingEvent } from "@/lib/use-outlook-loop";
import { usePersistedTimezone } from "@/lib/use-persisted-timezone";
import { COMMON_TIMEZONES } from "@/lib/timezones";
import { todayIso, formatTime12h } from "@/lib/format";
import type { Session } from "@/lib/session";
import type { LoopStop, ScheduledStop } from "@/lib/types";
import DateSelector from "./DateSelector";
import StopCard from "./StopCard";
import ConflictBanner from "./ConflictBanner";

type TimelineEntry =
  | { type: "stop"; time: string; stop: ScheduledStop; stopIndex: number }
  | { type: "event"; time: string; event: PreExistingEvent };

export default function LoopView({
  currentUser,
  subject,
  extraStops,
}: {
  currentUser: Session;
  /** Whose loop to show — defaults to the signed-in user themself. Used by
   * the admin "View All" role to preview another wholesaler's schedule. */
  subject?: { id: string; name: string; email: string };
  /**
   * Stops added this session elsewhere in the app (e.g. via the admin's
   * Internal view) that wouldn't otherwise show up here, since they aren't
   * persisted to Salesforce yet — see CheckFitTool's addedStops.
   */
  extraStops?: LoopStop[];
}) {
  const [date, setDate] = useState(todayIso());
  const who = subject ?? { id: currentUser.userId, name: currentUser.name };

  // Only relevant when previewing someone else's calendar (the admin "View
  // All" case) — Graph can't look up a different mailbox's timezone (see
  // lib/microsoft/calendar.ts), so it's picked manually and remembered per
  // subject. Viewing your own loop uses your own browser's zone instead
  // (handled inside useOutlookLoop), no picker needed.
  const [timeZone, setTimeZone] = usePersistedTimezone(
    `loop-review:timezone:${currentUser.userId}:${subject?.id ?? ""}`
  );

  // Omitting `target` (viewing your own loop) tells the API route to read
  // the caller's own Outlook connection/email from their session instead.
  const target = subject ? { wholesalerId: subject.id, email: subject.email, timeZone } : undefined;
  const { stops: outlookStops, preExisting, connected, loading } = useOutlookLoop(date, target);

  const estimatedLoop = useMemo(() => {
    const stops = [
      ...outlookStops,
      ...(extraStops ?? []).filter((s) => s.wholesalerId === who.id && s.meetingDate === date),
    ];
    return buildLoop(stops, date);
  }, [outlookStops, who.id, date, extraStops]);

  const loop = useRealDriveTimes(estimatedLoop);

  const conflictCount = loop.legs.filter((l) => l.status === "conflict").length;
  const tightCount = loop.legs.filter((l) => l.status === "tight").length;

  // A single chronological timeline of routed stops and pre-existing
  // calendar events, so a meeting doesn't visually disappear behind a
  // separate "also on the calendar" list further down the page.
  const timeline: TimelineEntry[] = useMemo(() => {
    const stopEntries: TimelineEntry[] = loop.stops.map((stop, stopIndex) => ({
      type: "stop",
      time: stop.meetingTime ?? stop.suggestedTime ?? "00:00",
      stop,
      stopIndex,
    }));
    const eventEntries: TimelineEntry[] = preExisting.map((event) => ({
      type: "event",
      time: event.start.slice(11, 16),
      event,
    }));
    return [...stopEntries, ...eventEntries].sort((a, b) => a.time.localeCompare(b.time));
  }, [loop.stops, preExisting]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-4 pt-3">
          <h1 className="text-xl font-extrabold text-brand-green">
            {subject ? `${subject.name}'s Loop` : "Today's Loop"}
          </h1>
          <a href="/api/auth/logout" className="text-xs font-semibold text-slate-400">
            {currentUser.name} · Log out
          </a>
        </div>
        <DateSelector date={date} onChange={setDate} />
        {subject && (
          <div className="px-4 pb-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
              {subject.name}&apos;s Timezone
              <select
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-normal"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {loop.stops.length > 0 && (
          <div className="flex gap-3 px-4 pb-3 text-sm font-semibold">
            <span className="text-slate-600">{loop.stops.length} stops</span>
            {conflictCount > 0 && (
              <span className="text-red-600">
                {conflictCount} conflict{conflictCount === 1 ? "" : "s"}
              </span>
            )}
            {tightCount > 0 && (
              <span className="text-amber-600">
                {tightCount} tight
              </span>
            )}
          </div>
        )}
      </header>

      <main className="flex-1 px-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-3">
        {!loading && !connected ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center text-slate-500">
            <span className="text-3xl">📅</span>
            <p className="font-semibold">Connect Outlook to see {subject ? `${subject.name}'s` : "your"} schedule.</p>
            <a
              href="/api/auth/microsoft/login"
              className="mt-2 flex h-11 items-center justify-center rounded-lg bg-brand-teal px-4 text-sm font-bold text-white active:opacity-80"
            >
              Connect Outlook
            </a>
          </div>
        ) : timeline.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center text-slate-500">
            <span className="text-3xl">📭</span>
            <p className="font-semibold">No stops scheduled for this date.</p>
          </div>
        ) : (
          timeline.map((entry, i) => {
            if (entry.type === "event") {
              return (
                <div key={entry.event.id} className="mb-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-sm font-semibold text-slate-800">{entry.event.subject}</p>
                  <p className="text-xs text-slate-500">
                    {formatTime12h(entry.event.start.slice(11, 16))} – {formatTime12h(entry.event.end.slice(11, 16))}
                    {entry.event.location && ` · ${entry.event.location}`}
                  </p>
                </div>
              );
            }

            const { stop, stopIndex } = entry;
            // Only show the drive-time leg when the very next item on the
            // timeline is the next routed stop — a pre-existing event in
            // between means there's no meaningful "leg" to show here.
            const next = timeline[i + 1];
            const showLeg =
              stopIndex < loop.legs.length && next?.type === "stop" && next.stopIndex === stopIndex + 1;

            return (
              <div key={stop.id}>
                <StopCard stop={stop} />
                {showLeg && (
                  <ConflictBanner
                    leg={loop.legs[stopIndex]}
                    fromName={stop.firmName}
                    toName={loop.stops[stopIndex + 1].firmName}
                  />
                )}
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
