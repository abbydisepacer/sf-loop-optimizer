import type { ScheduledStop } from "@/lib/types";
import { formatAddress, appleMapsUrl, googleMapsUrl } from "@/lib/maps-links";
import { formatTime12h, formatShortDate, formatAum } from "@/lib/format";

export default function StopCard({ stop }: { stop: ScheduledStop }) {
  const time = stop.meetingTime ?? stop.suggestedTime;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-lg font-bold text-white">
          {stop.sequence}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-lg font-bold leading-tight text-slate-900" title={stop.firmName}>
              {stop.firmName}
            </h2>
            {stop.additionalTitles?.map((title, i) => (
              <div key={i} className="flex min-w-0 flex-1 items-center gap-2">
                <span aria-hidden className="text-slate-300">|</span>
                <h2 className="min-w-0 flex-1 truncate text-lg font-bold leading-tight text-slate-900" title={title}>
                  {title}
                </h2>
              </div>
            ))}
          </div>
          {(stop.isFlexible || stop.fromCalendarEvent) && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {stop.isFlexible && (
                <span className="rounded-full bg-brand-blue/40 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-green">
                  Flexible
                </span>
              )}
              {stop.fromCalendarEvent && (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  From calendar
                </span>
              )}
            </div>
          )}
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
          {(stop.lastActivityDate || stop.locationAum != null) && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
              {stop.lastActivityDate && (
                <span>
                  Last Activity: <span className="font-semibold text-slate-700">{formatShortDate(stop.lastActivityDate)}</span>
                </span>
              )}
              {stop.locationAum != null && (
                <span>
                  Location AUM: <span className="font-semibold text-slate-700">{formatAum(stop.locationAum)}</span>
                </span>
              )}
            </div>
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
