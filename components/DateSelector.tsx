"use client";

import { formatDateHeading, isToday, todayIso } from "@/lib/format";

function shiftDate(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export default function DateSelector({
  date,
  onChange,
}: {
  date: string;
  onChange: (date: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <button
        aria-label="Previous day"
        onClick={() => onChange(shiftDate(date, -1))}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-slate-300 text-xl font-bold text-slate-700 active:bg-slate-100"
      >
        ‹
      </button>

      <div className="flex flex-1 flex-col items-center">
        <span className="text-lg font-bold text-slate-900">
          {isToday(date) ? "Today" : formatDateHeading(date)}
        </span>
        {isToday(date) ? (
          <span className="text-xs text-slate-500">{formatDateHeading(date)}</span>
        ) : (
          <button
            onClick={() => onChange(todayIso())}
            className="text-xs font-semibold text-blue-700"
          >
            Jump to today
          </button>
        )}
      </div>

      <input
        type="date"
        aria-label="Pick a date"
        value={date}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="h-12 shrink-0 rounded-xl border-2 border-slate-300 px-2 text-sm font-semibold text-slate-700"
      />

      <button
        aria-label="Next day"
        onClick={() => onChange(shiftDate(date, 1))}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-slate-300 text-xl font-bold text-slate-700 active:bg-slate-100"
      >
        ›
      </button>
    </div>
  );
}
