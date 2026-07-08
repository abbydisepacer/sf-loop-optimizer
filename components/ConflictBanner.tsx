import type { Leg } from "@/lib/types";
import { formatDriveMinutes } from "@/lib/format";

function SourceNote({ source }: { source: Leg["source"] }) {
  if (source === "estimate") {
    return <span className="text-slate-400"> (estimating…)</span>;
  }
  if (source === "unavailable") {
    return <span className="text-slate-400"> (live route unavailable — showing an estimate)</span>;
  }
  return null;
}

export default function ConflictBanner({
  leg,
  fromName,
  toName,
}: {
  leg: Leg;
  fromName: string;
  toName: string;
}) {
  if (leg.status === "ok") {
    return (
      <div className="flex items-center gap-2 py-3 pl-6 text-sm text-slate-500">
        <span aria-hidden className="text-base leading-none">↓</span>
        <span>
          Drive {formatDriveMinutes(leg.driveMinutes)} &middot; {leg.driveMiles} mi
          <SourceNote source={leg.source} />
        </span>
      </div>
    );
  }

  const isConflict = leg.status === "conflict";
  const available = leg.availableMinutes ?? 0;

  return (
    <div
      role="alert"
      className={`mx-2 my-2 rounded-xl border-2 px-4 py-3 text-sm font-medium ${
        isConflict
          ? "border-red-600 bg-red-50 text-red-800"
          : "border-amber-500 bg-amber-50 text-amber-900"
      }`}
    >
      <div className="flex items-center gap-2 font-bold uppercase tracking-wide">
        <span aria-hidden className="text-base">
          {isConflict ? "⚠" : "⏱"}
        </span>
        {isConflict ? "Scheduling conflict" : "Tight turnaround"}
      </div>
      <p className="mt-1 leading-snug">
        Only <span className="font-bold">{Math.max(available, 0)} min</span> between{" "}
        {fromName} and {toName} &mdash;{" "}
        <span className="font-bold">{formatDriveMinutes(leg.driveMinutes)}</span> drive required
        {isConflict ? " to make it on time." : "."}
        <SourceNote source={leg.source} />
      </p>
    </div>
  );
}
