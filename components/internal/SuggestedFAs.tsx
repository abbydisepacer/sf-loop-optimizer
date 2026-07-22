"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_SUGGESTION_FILTERS,
  DEFAULT_SUGGESTION_DURATION_MINUTES,
  type SuggestionFilters,
  type FaSuggestion,
  type SuggestionConfigFlags,
  type SuggestionDiagnostics,
} from "@/lib/salesforce/fa-suggestions";
import { verdictForFixedTime } from "@/lib/candidate-placement";
import { useScheduleVisit } from "@/lib/use-schedule-visit";
import { formatShortDate, formatAum } from "@/lib/format";
import type { LoopStop } from "@/lib/types";
import { VerdictPill } from "./CheckFitTool";

const DURATIONS = [15, 30, 45, 60];

type SuggestionsApiResult = {
  suggestions?: FaSuggestion[];
  configFlags?: SuggestionConfigFlags;
  diagnostics?: SuggestionDiagnostics;
  error?: string;
};

/** Explains where the list dropped to (or toward) zero, using the pipeline stage counts the API returns. */
function emptyResultReason(d: SuggestionDiagnostics | null): string | null {
  if (!d) return null;
  if (d.candidatesFound === 0) {
    return "No Contacts found within the search radius with a geocoded Account address — try a larger radius.";
  }
  if (d.withMeetingHistory === 0) {
    return `Found ${d.candidatesFound} Contact${d.candidatesFound === 1 ? "" : "s"} nearby, but none have any logged meeting history — they're treated as never met and skipped.`;
  }
  if (d.passedFilters === 0) {
    return `Found ${d.withMeetingHistory} with meeting history, but none fit the current recency/tier filters — try lowering "Days since last meeting" or including faded/prospect.`;
  }
  return null;
}

export default function SuggestedFAs({
  wholesalerId,
  date,
  existingStops,
  timeZone,
  wholesalerEmail,
  setAddedStops,
}: {
  wholesalerId: string;
  date: string;
  existingStops: LoopStop[];
  timeZone: string;
  wholesalerEmail: string | undefined;
  setAddedStops: (updater: (prev: LoopStop[]) => LoopStop[]) => void;
}) {
  const [filters, setFilters] = useState<SuggestionFilters>(DEFAULT_SUGGESTION_FILTERS);
  const [textFilter, setTextFilter] = useState("");
  const [suggestions, setSuggestions] = useState<FaSuggestion[] | null>(null);
  const [configFlags, setConfigFlags] = useState<SuggestionConfigFlags | null>(null);
  const [diagnostics, setDiagnostics] = useState<SuggestionDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  // Bumped on every completed search so each SuggestionRow below remounts
  // fresh (see its key prop) instead of reusing a prior instance whose
  // Time/Duration state was initialized from an earlier, now-stale
  // suggestedTime for the same contact.
  const [searchGeneration, setSearchGeneration] = useState(0);

  const hasStops = existingStops.length > 0;

  const runSearch = async () => {
    setLoading(true);
    setError(null);
    setStale(false);
    try {
      const res = await fetch("/api/salesforce/contacts/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wholesalerId, date, existingStops, filters }),
      });
      const data: SuggestionsApiResult = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Search failed — try again.");
        setSuggestions(null);
        setDiagnostics(null);
        return;
      }
      setSuggestions(data.suggestions ?? []);
      setConfigFlags(data.configFlags ?? null);
      setDiagnostics(data.diagnostics ?? null);
      setSearchGeneration((g) => g + 1);
    } catch (err) {
      console.error("Failed to fetch FA suggestions:", err);
      setError("Network error — please try again.");
      setSuggestions(null);
      setDiagnostics(null);
    } finally {
      setLoading(false);
    }
  };

  // Before the first search, configFlags hasn't loaded yet — treat the field
  // as usable until a search actually confirms SALESFORCE_LOCATION_AUM_FIELD
  // isn't set, rather than disabling it by default while configFlags is null.
  const aumFieldDisabled = configFlags !== null && !configFlags.locationAum;

  const filteredSuggestions = (suggestions ?? []).filter((s) => {
    if (!textFilter.trim()) return true;
    const needle = textFilter.trim().toLowerCase();
    return (
      s.contact.name.toLowerCase().includes(needle) ||
      s.contact.accountName.toLowerCase().includes(needle) ||
      (s.contact.title ?? "").toLowerCase().includes(needle)
    );
  });

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold text-brand-green">Suggested FAs to Call</h2>
        <button
          onClick={runSearch}
          disabled={!hasStops || loading}
          className="flex h-10 w-full items-center justify-center rounded-lg bg-brand-teal text-sm font-bold text-white active:opacity-80 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Find Suggestions"}
        </button>
      </div>

      {!hasStops && (
        <p className="text-sm text-slate-500">
          Add at least one stop to this day before searching — suggestions are centered on today&apos;s loop.
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <label htmlFor="sfa-min-days" className="text-xs font-semibold text-slate-600">
            Days since last meeting ≥
          </label>
          <label htmlFor="sfa-radius" className="text-xs font-semibold text-slate-600">
            Search radius (mi)
          </label>
          <input
            id="sfa-min-days"
            type="number"
            min={0}
            value={filters.minDaysSinceLastMeeting}
            onChange={(e) =>
              setFilters((f) => ({ ...f, minDaysSinceLastMeeting: Math.max(0, Number(e.target.value) || 0) }))
            }
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 font-normal"
          />
          <input
            id="sfa-radius"
            type="number"
            min={1}
            value={filters.radiusMiles}
            onChange={(e) => setFilters((f) => ({ ...f, radiusMiles: Math.max(1, Number(e.target.value) || 1) }))}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 font-normal"
          />
        </div>

        <label
          htmlFor="sfa-min-aum"
          className={`flex flex-col gap-1 text-xs font-semibold ${
            aumFieldDisabled ? "text-slate-300" : "text-slate-600"
          }`}
          title={aumFieldDisabled ? "Set SALESFORCE_LOCATION_AUM_FIELD to enable" : undefined}
        >
          Min Location AUM ($)
          <input
            id="sfa-min-aum"
            type="number"
            min={0}
            disabled={aumFieldDisabled}
            value={filters.minLocationAum}
            onChange={(e) =>
              setFilters((f) => ({ ...f, minLocationAum: Math.max(0, Number(e.target.value) || 0) }))
            }
            className="h-9 rounded-lg border border-slate-300 bg-white px-2 font-normal disabled:bg-slate-100 disabled:text-slate-400"
          />
        </label>

        <div className="flex flex-col gap-2 border-t border-slate-200 pt-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={filters.includeFaded}
              onChange={(e) => setFilters((f) => ({ ...f, includeFaded: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 accent-brand-teal"
            />
            Include faded (200–400 days)
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={filters.includeProspect}
              onChange={(e) => setFilters((f) => ({ ...f, includeProspect: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 accent-brand-teal"
            />
            Include prospect (400+ days)
          </label>
          <label
            className={`flex items-center gap-2 text-xs font-semibold ${
              configFlags?.priorityLists ? "text-slate-600" : "text-slate-300"
            }`}
            title={configFlags?.priorityLists ? undefined : "Set SALESFORCE_PRIORITY_LIST_FIELD to enable"}
          >
            <input
              type="checkbox"
              checked={filters.priorityListsOnly}
              disabled={!configFlags?.priorityLists}
              onChange={(e) => setFilters((f) => ({ ...f, priorityListsOnly: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 accent-brand-teal"
            />
            Priority lists only
          </label>
        </div>
      </div>

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      {suggestions && suggestions.length > 0 && (
        <input
          type="text"
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          placeholder="Filter these results by name, firm, or title…"
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
        />
      )}

      {stale && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          List may be stale — re-run Find Suggestions to re-check after an add.
        </p>
      )}

      {suggestions !== null && suggestions.length === 0 && (
        <p className="text-sm text-slate-500">
          {emptyResultReason(diagnostics) ?? "No FAs matched these criteria right now."}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {filteredSuggestions.map((suggestion) => (
          <SuggestionRow
            key={`${searchGeneration}-${suggestion.contact.id}`}
            suggestion={suggestion}
            wholesalerId={wholesalerId}
            wholesalerEmail={wholesalerEmail}
            timeZone={timeZone}
            date={date}
            existingStops={existingStops}
            setAddedStops={setAddedStops}
            onAdded={() => setStale(true)}
          />
        ))}
      </div>
    </section>
  );
}

function SuggestionRow({
  suggestion,
  wholesalerId,
  wholesalerEmail,
  timeZone,
  date,
  existingStops,
  setAddedStops,
  onAdded,
}: {
  suggestion: FaSuggestion;
  wholesalerId: string;
  wholesalerEmail: string | undefined;
  timeZone: string;
  date: string;
  existingStops: LoopStop[];
  setAddedStops: (updater: (prev: LoopStop[]) => LoopStop[]) => void;
  onAdded: () => void;
}) {
  const [time, setTime] = useState(suggestion.suggestedTime ?? "");
  const [duration, setDuration] = useState(suggestion.durationMinutes ?? DEFAULT_SUGGESTION_DURATION_MINUTES);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const { state, error, submit, requestConfirm, reset } = useScheduleVisit(setAddedStops);
  const { contact, score, daysSinceLastMeeting } = suggestion;

  const phone = contact.phone ?? contact.mobilePhone;
  const canAdd = Boolean(time && wholesalerEmail);

  // Re-derived from the current Time/Duration on every render — the API's
  // suggestion.verdict only ever reflects the server's originally suggested
  // time/duration, so it goes stale the moment either is edited here.
  const verdict = useMemo(() => {
    if (!time) return "conflict" as const;
    return verdictForFixedTime(
      existingStops,
      {
        wholesalerId,
        accountId: contact.accountId,
        firmName: `${contact.name} — ${contact.accountName}`,
        address: contact.address,
        lat: contact.lat as number,
        lng: contact.lng as number,
        meetingDate: date,
        meetingTime: time,
        durationMinutes: duration,
        lastActivityDate: contact.lastActivityDate,
        locationAum: contact.locationAum,
      },
      date
    );
  }, [existingStops, wholesalerId, contact, date, time, duration]);

  const handleAdd = async () => {
    if (!canAdd || !wholesalerEmail) return;
    const ok = await submit({
      wholesalerId,
      wholesalerEmail,
      timeZone,
      accountId: contact.accountId,
      firmName: `${contact.name} — ${contact.accountName}`,
      address: contact.address,
      lat: contact.lat as number,
      lng: contact.lng as number,
      meetingDate: date,
      meetingTime: time,
      durationMinutes: duration,
      lastActivityDate: contact.lastActivityDate,
      locationAum: contact.locationAum,
    });
    if (ok) onAdded();
  };

  const handleAddClick = () => {
    if (verdict === "ok") {
      handleAdd();
    } else {
      requestConfirm();
    }
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border px-4 py-3 ${
        score.flags.edwardJones ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-slate-800">
          {contact.name}
          {contact.title && <span className="font-normal text-slate-500"> · {contact.title}</span>}
        </p>
        <p className="text-xs text-slate-500">{contact.accountName}</p>
        {contact.lastActivityDate && (
          <p className="text-xs text-slate-500">
            Last meeting: <span className="font-semibold text-slate-700">{formatShortDate(contact.lastActivityDate)}</span>{" "}
            ({daysSinceLastMeeting} days ago)
          </p>
        )}
        {contact.locationAum != null && (
          <p className="text-xs text-slate-500">
            Location AUM: <span className="font-semibold text-slate-700">{formatAum(contact.locationAum)}</span>
          </p>
        )}
        {phone && (
          <a href={`tel:${phone}`} className="text-xs font-semibold text-brand-teal underline">
            {phone}
          </a>
        )}
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {score.tier}
          </span>
          <VerdictPill verdict={verdict} />
          {score.flags.edwardJones && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">
              Low priority
            </span>
          )}
          {score.flags.ameripriseCallOnly && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">
              Call only
            </span>
          )}
          {score.flags.shareCountRedFlag && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
              Share count
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Time
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              reset();
            }}
            className="h-9 rounded-lg border border-slate-300 px-2 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Duration
          <select
            value={duration}
            onChange={(e) => {
              setDuration(Number(e.target.value));
              reset();
            }}
            className="h-9 rounded-lg border border-slate-300 px-2 font-normal"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} min
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setShowBreakdown((v) => !v)}
          className="text-xs font-semibold text-slate-500 underline"
        >
          {showBreakdown ? "Hide" : "Why suggested?"}
        </button>

        <div className="flex flex-col items-end gap-1">
          {state === "confirming" ? (
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs font-semibold text-amber-800">
                {verdict === "conflict" ? "Conflict — add anyway?" : "Tight — add anyway?"}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  className="h-9 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white active:bg-amber-700"
                >
                  Yes
                </button>
                <button
                  onClick={reset}
                  className="h-9 rounded-lg border-2 border-amber-600 px-3 text-xs font-bold text-amber-800 active:bg-amber-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : state === "success" ? (
            <span className="text-xs font-bold text-emerald-700">✅ Added</span>
          ) : (
            <button
              onClick={handleAddClick}
              disabled={!canAdd || state === "submitting"}
              className="h-9 rounded-lg bg-brand-teal px-4 text-xs font-bold text-white active:opacity-80 disabled:opacity-50"
            >
              {state === "submitting" ? "Adding…" : "Add to Schedule"}
            </button>
          )}
          {state === "error" && error && <p className="text-xs font-medium text-red-600">{error}</p>}
        </div>
      </div>

      {showBreakdown && (
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p>
            Base ({score.tier}): {score.base}
          </p>
          {score.boosts.map((b) => (
            <p key={b.label}>
              + {b.label}: {b.amount}
            </p>
          ))}
          <p className="font-bold">Total: {score.total}</p>
        </div>
      )}
    </div>
  );
}
