import type { ScheduledStop } from "@/lib/types";
import { formatAddress, appleMapsUrl, googleMapsUrl } from "@/lib/maps-links";
import { formatTime12h } from "@/lib/format";

export default function StopCard({ stop }: { stop: ScheduledStop }) {
  const time = stop.meetingTime ?? stop.suggestedTime;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-lg font-bold text-white">
          {stop.sequence}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold leading-tight text-slate-900">
              {stop.firmName}
            </h2>
            {stop.isFlexible && (
              <span className="rounded-full bg-brand-blue/40 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-green">
                Flexible
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-500">{formatAddress(stop.address)}</p>
          <p className="mt-1 text-base font-semibold text-slate-800">
            {time ? formatTime12h(time) : "Time TBD"}
            {stop.isFlexible && stop.suggestedTime && (
              <span className="ml-1 font-normal text-slate-500">(suggested slot)</span>
            )}
            <span className="ml-2 font-normal text-slate-500">&middot; {stop.durationMinutes} min</span>
          </p>
          {stop.notes && (
            <p className="mt-1 text-sm italic text-slate-500">{stop.notes}</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <a
          href={appleMapsUrl(stop.address)}
          className="flex h-14 items-center justify-center gap-2 rounded-xl bg-slate-900 text-base font-semibold text-white active:bg-slate-700"
        >
          Apple Maps
        </a>
        <a
          href={googleMapsUrl(stop.address)}
          className="flex h-14 items-center justify-center gap-2 rounded-xl border-2 border-slate-900 text-base font-semibold text-slate-900 active:bg-slate-100"
        >
          Google Maps
        </a>
      </div>

      {stop.sfId && (
        <p className="mt-3 truncate text-xs text-slate-400">SFDC: {stop.sfId}</p>
      )}
    </div>
  );
}
