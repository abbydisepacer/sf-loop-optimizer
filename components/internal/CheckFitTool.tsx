"use client";

import { useEffect, useMemo, useState } from "react";
import { getStopsForDate } from "@/lib/mock-data";
import { buildLoop } from "@/lib/routing-engine";
import { useRealDriveTimes } from "@/lib/use-real-drive-times";
import { formatAddress } from "@/lib/maps-links";
import { todayIso } from "@/lib/format";
import type { LoopStop, LegStatus } from "@/lib/types";
import type { Session } from "@/lib/session";
import type { AccountSearchResult } from "@/lib/salesforce/accounts";
import type { ScheduleVisitResult } from "@/lib/salesforce/loop-write";
import StopCard from "@/components/StopCard";
import ConflictBanner from "@/components/ConflictBanner";
import AddressAutocompleteInput, { type PlaceSelection } from "@/components/internal/AddressAutocompleteInput";
import FirmNameAutocompleteInput from "@/components/internal/FirmNameAutocompleteInput";
import RouteMap from "@/components/internal/RouteMap";

const DURATIONS = [15, 30, 45, 60];
const CANDIDATE_ID = "candidate";

export default function CheckFitTool({
  currentUser,
  addedStops: controlledAddedStops,
  onAddedStopsChange,
}: {
  currentUser: Session;
  /**
   * Lets a parent (the admin view switcher) share this session's added
   * stops with the External view, so a firm added here shows up there too.
   * Falls back to local state for a plain internal-wholesaler session,
   * which has no External view to share with.
   */
  addedStops?: LoopStop[];
  onAddedStopsChange?: (updater: (prev: LoopStop[]) => LoopStop[]) => void;
}) {
  const assignedExternals = currentUser.assignedExternals ?? [];
  const [wholesalerId, setWholesalerId] = useState(assignedExternals[0]?.id ?? "");
  const [date, setDate] = useState(todayIso());
  const [firmName, setFirmName] = useState("");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Where the current coords came from, so the status message below the
  // address field is accurate about it.
  const [coordsSource, setCoordsSource] = useState<"account" | "search" | "auto" | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);
  const [scheduleState, setScheduleState] = useState<
    "idle" | "confirming" | "submitting" | "success" | "error"
  >("idle");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  // Captured at submit time so the success message can still name the firm
  // after the candidate fields are cleared.
  const [lastScheduledFirmName, setLastScheduledFirmName] = useState("");
  // Stops successfully "added" this session (see scheduleVisit's TODO — the
  // write itself is mocked, so this is the only place they exist yet).
  // Merged into the displayed loop so an add is immediately visible without
  // implying it's actually been saved to Salesforce.
  const [localAddedStops, setLocalAddedStops] = useState<LoopStop[]>([]);
  const addedStops = controlledAddedStops ?? localAddedStops;
  const setAddedStops = onAddedStopsChange ?? setLocalAddedStops;

  // Clears any stale confirm/error state left over from a previous submit
  // attempt on this same candidate. Not called from the auto-clear-on-success
  // path below, since that's a programmatic reset, not the user editing.
  const clearStaleScheduleState = () => {
    setScheduleState("idle");
    setScheduleError(null);
  };

  const handleFirmNameChange = (value: string) => {
    setFirmName(value);
    // Typing breaks the link to whichever Account was previously selected.
    setAccountId(null);
    clearStaleScheduleState();
  };

  const handleAddressChange = (value: string) => {
    setAddress(value);
    // Typing invalidates any previously selected place's coordinates —
    // an autocomplete selection will set them again right after. If none
    // comes, the auto-geocode effect below resolves real coordinates for
    // whatever was typed rather than guessing.
    setCoords(null);
    setCoordsSource(null);
    setGeocodeFailed(false);
    setAccountId(null);
    clearStaleScheduleState();
  };

  const handlePlaceSelected = async (place: PlaceSelection) => {
    setCoords({ lat: place.lat, lng: place.lng });
    setCoordsSource("search");

    // Prefer a Salesforce Account at this location over Google's own
    // business-name guess — it's the authoritative source for firms we
    // already track, and matches on geographic proximity so formatting
    // differences between Google's address and Salesforce's don't matter.
    const streetFragment = place.address.split(",")[0] ?? "";
    try {
      const res = await fetch(
        `/api/salesforce/accounts/search-by-address?lat=${place.lat}&lng=${place.lng}&street=${encodeURIComponent(streetFragment)}`
      );
      const data: { accounts?: AccountSearchResult[] } = await res.json();
      const match = data.accounts?.[0];
      if (match) {
        setFirmName((current) => (current.trim() ? current : match.name));
        setAccountId(match.id);
        return;
      }
    } catch (err) {
      console.error("Address-based Account lookup failed:", err);
    }

    // No Salesforce match — fall back to Google's business name, if any.
    if (place.name) {
      setFirmName((current) => (current.trim() ? current : place.name!));
    }
  };

  const handleAccountSelected = (account: AccountSearchResult) => {
    setFirmName(account.name);
    setAccountId(account.id);
    setAddress(formatAddress(account.address));
    setGeocodeFailed(false);
    if (account.lat !== null && account.lng !== null) {
      setCoords({ lat: account.lat, lng: account.lng });
      setCoordsSource("account");
    } else {
      // No geolocation on file — the auto-geocode effect below resolves
      // real coordinates from the account's address text instead.
      setCoords(null);
      setCoordsSource(null);
    }
  };

  // Resolves real coordinates for whatever address is currently entered,
  // whenever it didn't come from an explicit Places/Account selection —
  // covers addresses typed and left as-is, and Accounts with no geocoded
  // Billing Address on file. Never falls back to a guessed location.
  useEffect(() => {
    if (!address.trim() || coords) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      setGeocodeFailed(false);
      setGeocoding(true);
      fetch(`/api/geocode?address=${encodeURIComponent(address.trim())}`)
        .then((res) => res.json())
        .then((data: { result: { lat: number; lng: number } | null }) => {
          if (cancelled) return;
          if (data.result) {
            setCoords({ lat: data.result.lat, lng: data.result.lng });
            setCoordsSource("auto");
          } else {
            setGeocodeFailed(true);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("Geocoding failed:", err);
          setGeocodeFailed(true);
        })
        .finally(() => {
          if (!cancelled) setGeocoding(false);
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address, coords]);

  const baseLoop = useMemo(() => {
    const stops = [
      ...getStopsForDate(wholesalerId, date),
      ...addedStops.filter((s) => s.wholesalerId === wholesalerId && s.meetingDate === date),
    ];
    return buildLoop(stops, date);
  }, [wholesalerId, date, addedStops]);

  const candidateResult = useMemo(() => {
    // Requires real coords — never builds a candidate at a guessed location.
    if (!address.trim() || !time || !coords) return null;

    const candidate: LoopStop = {
      id: CANDIDATE_ID,
      sfId: accountId ?? undefined,
      wholesalerId,
      firmName: firmName.trim() || "Candidate firm",
      address: { street: address.trim(), city: "", state: "", zip: "" },
      ...coords,
      meetingDate: date,
      meetingTime: time,
      durationMinutes: duration,
    };

    const existing = [
      ...getStopsForDate(wholesalerId, date),
      ...addedStops.filter((s) => s.wholesalerId === wholesalerId && s.meetingDate === date),
    ];
    const loop = buildLoop([...existing, candidate], date);
    const index = loop.stops.findIndex((s) => s.id === CANDIDATE_ID);

    return { loop, index };
  }, [wholesalerId, date, firmName, address, coords, accountId, time, duration, addedStops]);

  const wholesalerName = assignedExternals.find((w) => w.id === wholesalerId)?.name;
  const estimatedDisplayLoop = candidateResult ? candidateResult.loop : baseLoop;
  const displayLoop = useRealDriveTimes(estimatedDisplayLoop);

  const candidateIndex = candidateResult?.index ?? -1;
  const verdict: LegStatus | null = useMemo(() => {
    if (candidateIndex < 0) return null;
    const incomingLeg = candidateIndex > 0 ? displayLoop.legs[candidateIndex - 1] : null;
    const outgoingLeg =
      candidateIndex < displayLoop.stops.length - 1 ? displayLoop.legs[candidateIndex] : null;
    const statuses = [incomingLeg?.status, outgoingLeg?.status].filter(Boolean);
    if (statuses.includes("conflict")) return "conflict";
    if (statuses.includes("tight")) return "tight";
    return "ok";
  }, [candidateIndex, displayLoop]);

  const submitSchedule = async () => {
    if (!coords) return; // guard only — the button isn't reachable without real coords
    setScheduleState("submitting");
    try {
      const res = await fetch("/api/loop/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wholesalerId,
          accountId,
          firmName: firmName.trim() || "Candidate firm",
          address: { street: address.trim(), city: "", state: "", zip: "" },
          meetingDate: date,
          meetingTime: time,
          durationMinutes: duration,
        }),
      });
      const result: ScheduleVisitResult = await res.json();
      if (result.success) {
        setAddedStops((prev) => [
          ...prev,
          {
            id: result.recordId,
            sfId: result.recordId,
            mockRecord: result.mocked,
            wholesalerId,
            firmName: firmName.trim() || "Candidate firm",
            address: { street: address.trim(), city: "", state: "", zip: "" },
            ...coords,
            meetingDate: date,
            meetingTime: time,
            durationMinutes: duration,
          },
        ]);
        // Clear the candidate fields immediately — otherwise they'd still
        // describe a "candidate" identical to the stop we just added,
        // which would register as conflicting with itself.
        setLastScheduledFirmName(firmName.trim() || "Candidate firm");
        setFirmName("");
        setAddress("");
        setCoords(null);
        setAccountId(null);
        setTime("");
        setScheduleState("success");
      } else {
        setScheduleError(result.error ?? "Something went wrong.");
        setScheduleState("error");
      }
    } catch (err) {
      console.error("Failed to schedule visit:", err);
      setScheduleError("Network error — please try again.");
      setScheduleState("error");
    }
  };

  const handleAddToScheduleClick = () => {
    if (verdict === "ok") {
      submitSchedule();
    } else {
      setScheduleState("confirming");
    }
  };

  // Added stops only exist as session-local state (see scheduleVisit's TODO),
  // so "removing" one is just dropping it from that state — there's nothing
  // in Salesforce to undo yet.
  const handleRemoveStop = (stopId: string) => {
    setAddedStops((prev) => prev.filter((s) => s.id !== stopId));
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 bg-slate-50 px-6 py-8">
      <header>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-brand-green">Wholesaler Loop Review</h1>
          <a href="/api/auth/logout" className="text-xs font-semibold text-slate-400">
            {currentUser.name} · Log out
          </a>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Review a wholesaler&apos;s scheduled loop, and preview how a prospective firm would fit
          in before adding it. Nothing is saved until you click Add to Schedule.
        </p>
      </header>

      {assignedExternals.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center text-slate-500">
          <span className="text-3xl">🗂️</span>
          <p className="font-semibold">No external wholesalers are assigned to you in Salesforce.</p>
          <p className="text-sm">
            Check the Internal Wholesaler lookup on their User records if this looks wrong.
          </p>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Wholesaler
              <select
                value={wholesalerId}
                onChange={(e) => {
                  setWholesalerId(e.target.value);
                  clearStaleScheduleState();
                }}
                className="h-11 rounded-lg border border-slate-300 px-3 font-normal"
              >
                {assignedExternals.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  clearStaleScheduleState();
                }}
                className="h-11 rounded-lg border border-slate-300 px-3 font-normal"
              />
            </label>

            <div className="hidden lg:block" />

            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Candidate Firm Name/Phone
              <FirmNameAutocompleteInput
                value={firmName}
                onChange={handleFirmNameChange}
                onAccountSelected={handleAccountSelected}
                placeholder="Search by name or phone…"
                className="h-11 w-full rounded-lg border border-slate-300 px-3 font-normal"
              />
              {accountId && (
                <span className="text-xs font-normal text-emerald-600">
                  Existing Salesforce Account — address filled in from their record
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
              Candidate Address
              <AddressAutocompleteInput
                value={address}
                onChange={handleAddressChange}
                onPlaceSelected={handlePlaceSelected}
                placeholder="Start typing an address…"
                className="h-11 w-full rounded-lg border border-slate-300 px-3 font-normal"
              />
              {address && (
                <span
                  className={`text-xs font-normal ${
                    coords ? "text-emerald-600" : geocodeFailed ? "text-red-600" : "text-slate-400"
                  }`}
                >
                  {coords
                    ? coordsSource === "account"
                      ? "Using this Account's geocoded address on file"
                      : coordsSource === "search"
                        ? "Using precise location from address search"
                        : "Using a geocoded location for this address"
                    : geocoding
                      ? "Resolving location…"
                      : geocodeFailed
                        ? "Couldn't find that address — check it and try again"
                        : "Pick a suggestion for a precise drive-time estimate"}
                </span>
              )}
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Meeting Time
                <input
                  type="time"
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    clearStaleScheduleState();
                  }}
                  className="h-11 rounded-lg border border-slate-300 px-3 font-normal"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Duration
                <select
                  value={duration}
                  onChange={(e) => {
                    setDuration(Number(e.target.value));
                    clearStaleScheduleState();
                  }}
                  className="h-11 rounded-lg border border-slate-300 px-3 font-normal"
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} min
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {baseLoop.stops.length === 0 && !candidateResult ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center text-slate-500">
              <span className="text-3xl">📭</span>
              <p className="font-semibold">{wholesalerName} has no stops scheduled for this date.</p>
              <p className="text-sm">Enter a candidate firm above to check whether it fits.</p>
            </div>
          ) : (
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                <div className="sticky top-4 z-10">
                  {verdict ? (
                    <VerdictBanner verdict={verdict} />
                  ) : (
                    <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-500">
                      Showing {wholesalerName}&apos;s scheduled loop. Enter a candidate firm above
                      to check whether it fits.
                    </p>
                  )}
                </div>

                {(verdict || scheduleState === "success") && (
                  <div>
                    {scheduleState === "success" ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                        <span>
                          ✅ Added {lastScheduledFirmName} to {wholesalerName}&apos;s schedule.
                        </span>
                        <button onClick={() => setScheduleState("idle")} className="font-bold underline">
                          Dismiss
                        </button>
                      </div>
                    ) : scheduleState === "confirming" ? (
                      <div className="flex flex-col gap-2 rounded-xl border-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        <p className="font-semibold">
                          {verdict === "conflict"
                            ? "This creates a scheduling conflict — add anyway?"
                            : "This is a tight turnaround — add anyway?"}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={submitSchedule}
                            className="h-10 rounded-lg bg-amber-600 px-4 text-sm font-bold text-white active:bg-amber-700"
                          >
                            Yes, schedule anyway
                          </button>
                          <button
                            onClick={() => setScheduleState("idle")}
                            className="h-10 rounded-lg border-2 border-amber-600 px-4 text-sm font-bold text-amber-800 active:bg-amber-100"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={handleAddToScheduleClick}
                          disabled={scheduleState === "submitting"}
                          className="flex h-11 items-center justify-center rounded-lg bg-brand-teal px-4 text-sm font-bold text-white active:opacity-80 disabled:opacity-60"
                        >
                          {scheduleState === "submitting" ? "Adding…" : "Add to Schedule"}
                        </button>
                        {scheduleState === "error" && (
                          <p className="text-xs font-medium text-red-600">{scheduleError}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-0">
                  {displayLoop.stops.map((stop, i) => (
                    <div key={stop.id}>
                      {stop.id === CANDIDATE_ID && verdict && (
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-wide text-brand-orange">
                            Candidate firm
                          </span>
                          <VerdictPill verdict={verdict} />
                        </div>
                      )}
                      {stop.mockRecord !== undefined && (
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p
                            className={`text-xs font-bold uppercase tracking-wide ${
                              stop.mockRecord ? "text-amber-700" : "text-emerald-700"
                            }`}
                          >
                            {stop.mockRecord ? "Added this session" : "Saved"}
                          </p>
                          {stop.mockRecord && (
                            <button
                              onClick={() => handleRemoveStop(stop.id)}
                              className="text-xs font-bold uppercase tracking-wide text-red-600 underline underline-offset-2"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      )}
                      <div className={stop.id === CANDIDATE_ID ? "rounded-2xl ring-2 ring-brand-orange" : ""}>
                        <StopCard stop={stop} />
                      </div>
                      {i < displayLoop.legs.length && (
                        <ConflictBanner
                          leg={displayLoop.legs[i]}
                          fromName={stop.firmName}
                          toName={displayLoop.stops[i + 1].firmName}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)]">
                <RouteMap
                  stops={displayLoop.stops}
                  legs={displayLoop.legs}
                  candidateId={candidateResult ? CANDIDATE_ID : undefined}
                />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

const VERDICT_COPY = {
  ok: {
    icon: "✅",
    label: "Fits cleanly",
    bannerStyle: "border-emerald-600 bg-emerald-50 text-emerald-800",
    pillStyle: "bg-emerald-600 text-white",
  },
  tight: {
    icon: "⏱",
    label: "Fits, but tight",
    bannerStyle: "border-amber-500 bg-amber-50 text-amber-900",
    pillStyle: "bg-amber-500 text-white",
  },
  conflict: {
    icon: "⚠",
    label: "Doesn't fit — conflict",
    bannerStyle: "border-red-600 bg-red-50 text-red-800",
    pillStyle: "bg-red-600 text-white",
  },
} satisfies Record<"ok" | "tight" | "conflict", { icon: string; label: string; bannerStyle: string; pillStyle: string }>;

function VerdictBanner({ verdict }: { verdict: "ok" | "tight" | "conflict" }) {
  const copy = VERDICT_COPY[verdict];
  return (
    <div className={`rounded-xl border-2 px-4 py-3 text-lg font-bold shadow-sm ${copy.bannerStyle}`}>
      {copy.icon} {copy.label}
    </div>
  );
}

/** Compact fit/no-fit badge pinned directly to the candidate's stop card. */
function VerdictPill({ verdict }: { verdict: "ok" | "tight" | "conflict" }) {
  const copy = VERDICT_COPY[verdict];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${copy.pillStyle}`}>
      {copy.icon} {copy.label}
    </span>
  );
}
