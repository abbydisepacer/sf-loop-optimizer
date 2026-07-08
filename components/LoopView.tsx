"use client";

import { useMemo, useState } from "react";
import { getStopsForDate } from "@/lib/mock-data";
import { buildLoop } from "@/lib/routing-engine";
import { useRealDriveTimes } from "@/lib/use-real-drive-times";
import { todayIso } from "@/lib/format";
import type { Session } from "@/lib/session";
import type { LoopStop } from "@/lib/types";
import DateSelector from "./DateSelector";
import StopCard from "./StopCard";
import ConflictBanner from "./ConflictBanner";

export default function LoopView({
  currentUser,
  subject,
  extraStops,
}: {
  currentUser: Session;
  /** Whose loop to show — defaults to the signed-in user themself. Used by
   * the admin "View All" role to preview another wholesaler's schedule. */
  subject?: { id: string; name: string };
  /**
   * Stops added this session elsewhere in the app (e.g. via the admin's
   * Internal view) that wouldn't otherwise show up here, since they aren't
   * persisted to Salesforce yet — see CheckFitTool's addedStops.
   */
  extraStops?: LoopStop[];
}) {
  const [date, setDate] = useState(todayIso());
  const who = subject ?? { id: currentUser.userId, name: currentUser.name };

  const estimatedLoop = useMemo(() => {
    const stops = [
      ...getStopsForDate(who.id, date),
      ...(extraStops ?? []).filter((s) => s.wholesalerId === who.id && s.meetingDate === date),
    ];
    return buildLoop(stops, date);
  }, [who.id, date, extraStops]);

  const loop = useRealDriveTimes(estimatedLoop);

  const conflictCount = loop.legs.filter((l) => l.status === "conflict").length;
  const tightCount = loop.legs.filter((l) => l.status === "tight").length;

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
        {loop.stops.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center text-slate-500">
            <span className="text-3xl">📭</span>
            <p className="font-semibold">No stops scheduled for this date.</p>
          </div>
        ) : (
          loop.stops.map((stop, i) => (
            <div key={stop.id}>
              <StopCard stop={stop} />
              {i < loop.legs.length && (
                <ConflictBanner
                  leg={loop.legs[i]}
                  fromName={stop.firmName}
                  toName={loop.stops[i + 1].firmName}
                />
              )}
            </div>
          ))
        )}
      </main>
    </div>
  );
}
