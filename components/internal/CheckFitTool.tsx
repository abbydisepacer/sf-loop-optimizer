"use client";

import { useEffect, useMemo, useState } from "react";
import { buildLoop, isSameLocation, mergeDuplicateStops } from "@/lib/routing-engine";
import { useRealDriveTimes } from "@/lib/use-real-drive-times";
import { useOutlookLoop } from "@/lib/use-outlook-loop";
import { usePersistedTimezone } from "@/lib/use-persisted-timezone";
import { usePersistedValue } from "@/lib/use-persisted-value";
import { useScheduleVisit } from "@/lib/use-schedule-visit";
import { COMMON_TIMEZONES } from "@/lib/timezones";
import { formatAddress } from "@/lib/maps-links";
import { todayIso, formatTime12h } from "@/lib/format";
import type { LoopStop, LegStatus } from "@/lib/types";
import type { Session } from "@/lib/session";
import type { AccountSearchResult } from "@/lib/salesforce/accounts";
import StopCard from "@/components/StopCard";
import ConflictBanner from "@/components/ConflictBanner";
import AddressAutocompleteInput, { type PlaceSelection } from "@/components/internal/AddressAutocompleteInput";
import FirmNameAutocompleteInput from "@/components/internal/FirmNameAutocompleteInput";
import SuggestedFAs from "@/components/internal/SuggestedFAs";
import RouteMap from "@/components/RouteMap";

const DURATIONS = [15, 30, 45, 60];
const CANDIDATE_ID = "candidate";

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Pure time-window overlap — pre-existing calendar events have no lat/lng, so this can't go through the drive-time leg logic. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

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
  // Scoped per signed-in internal/admin user, in case a shared device is
  // ever used by more than one of them.
  const wholesalerStorageKey = `loop-review:selected-wholesaler:${currentUser.userId}`;
  const defaultWholesalerId = assignedExternals[0]?.id ?? "";
  const [storedWholesalerId, setWholesalerId] = usePersistedValue(wholesalerStorageKey, defaultWholesalerId);
  // Falls back to the first assigned wholesaler if the saved id is no
  // longer one of them (e.g. their assignment changed since it was saved).
  const wholesalerId = assignedExternals.some((w) => w.id === storedWholesalerId)
    ? storedWholesalerId
    : defaultWholesalerId;
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
  // Captured alongside accountId so the candidate preview (and the stop
  // added from it) can show Last Activity Date / Location AUM without an
  // extra round-trip — the account search/lookup already returns them.
  const [accountDetails, setAccountDetails] = useState<{
    lastActivityDate: string | null;
    locationAum: number | null;
  } | null>(null);
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);
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
  const [removingStopId, setRemovingStopId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ stopId: string; message: string } | null>(null);

  const wholesalerEmail = assignedExternals.find((w) => w.id === wholesalerId)?.email;
  const [timeZone, setTimeZone] = usePersistedTimezone(
    `loop-review:timezone:${currentUser.userId}:${wholesalerId}`
  );
  const {
    stops: outlookStops,
    preExisting,
    connected: outlookConnected,
    loading: outlookLoading,
  } = useOutlookLoop(date, wholesalerEmail ? { wholesalerId, email: wholesalerEmail, timeZone } : undefined);

  const {
    state: scheduleState,
    error: scheduleError,
    submit,
    requestConfirm,
    reset: clearStaleScheduleState,
  } = useScheduleVisit(setAddedStops);

  const handleFirmNameChange = (value: string) => {
    setFirmName(value);
    // Typing breaks the link to whichever Account was previously selected.
    setAccountId(null);
    setAccountDetails(null);
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
    setAccountDetails(null);
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
        setAccountDetails({ lastActivityDate: match.lastActivityDate, locationAum: match.locationAum });
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
    setAccountDetails({ lastActivityDate: account.lastActivityDate, locationAum: account.locationAum });
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

  // Deduplicated once here (not inside buildLoop) specifically so a
  // brand-new candidate the internal is actively checking never gets
  // silently merged away just because it happens to match an existing
  // stop's time and location.
  const existingStops = useMemo(() => {
    const stops = [
      ...outlookStops,
      ...addedStops.filter((s) => s.wholesalerId === wholesalerId && s.meetingDate === date),
    ];
    return mergeDuplicateStops(stops);
  }, [outlookStops, wholesalerId, date, addedStops]);

  const baseLoop = useMemo(() => buildLoop(existingStops, date), [existingStops, date]);

  const candidateResult = useMemo(() => {
    // Requires real coords — never builds a candidate at a guessed location.
    if (!address.trim() || !time || !coords) return null;

    const candidate: LoopStop = {
      id: CANDIDATE_ID,
      sfId: accountId ?? undefined,
      accountId: accountId ?? undefined,
      lastActivityDate: accountDetails?.lastActivityDate ?? null,
      locationAum: accountDetails?.locationAum ?? null,
      wholesalerId,
      firmName: firmName.trim() || "Candidate firm",
      address: { street: address.trim(), city: "", state: "", zip: "" },
      ...coords,
      meetingDate: date,
      meetingTime: time,
      durationMinutes: duration,
    };

    const loop = buildLoop([...existingStops, candidate], date);
    const index = loop.stops.findIndex((s) => s.id === CANDIDATE_ID);

    return { loop, index };
  }, [existingStops, wholesalerId, date, firmName, address, coords, accountId, accountDetails, time, duration]);

  const wholesalerName = assignedExternals.find((w) => w.id === wholesalerId)?.name;
  const estimatedDisplayLoop = candidateResult ? candidateResult.loop : baseLoop;
  const displayLoop = useRealDriveTimes(estimatedDisplayLoop);

  const candidateIndex = candidateResult?.index ?? -1;

  // Pre-existing calendar events (no lat/lng, so they never go through
  // buildLoop's drive-time legs) still need to block the candidate time
  // slot outright if they overlap — this is a straightforward double-
  // booking, not a drive-time squeeze.
  const candidateOverlapsExisting = useMemo(() => {
    if (candidateIndex < 0 || !time) return false;
    const candidateStart = toMinutes(time);
    const candidateEnd = candidateStart + duration;
    return preExisting.some((event) => {
      const eventStart = toMinutes(event.start.slice(11, 16));
      const eventEnd = toMinutes(event.end.slice(11, 16));
      return overlaps(candidateStart, candidateEnd, eventStart, eventEnd);
    });
  }, [candidateIndex, time, duration, preExisting]);

  const verdict: LegStatus | null = useMemo(() => {
    if (candidateIndex < 0) return null;
    if (candidateOverlapsExisting) return "conflict";
    const incomingLeg = candidateIndex > 0 ? displayLoop.legs[candidateIndex - 1] : null;
    const outgoingLeg =
      candidateIndex < displayLoop.stops.length - 1 ? displayLoop.legs[candidateIndex] : null;
    const statuses = [incomingLeg?.status, outgoingLeg?.status].filter(Boolean);
    if (statuses.includes("conflict")) return "conflict";
    if (statuses.includes("tight")) return "tight";
    return "ok";
  }, [candidateIndex, candidateOverlapsExisting, displayLoop]);

  const submitSchedule = async () => {
    if (!coords || !wholesalerEmail) return; // guard only — the button isn't reachable without these
    const ok = await submit({
      wholesalerId,
      wholesalerEmail,
      timeZone,
      accountId,
      firmName: firmName.trim() || "Candidate firm",
      address: { street: address.trim(), city: "", state: "", zip: "" },
      ...coords,
      meetingDate: date,
      meetingTime: time,
      durationMinutes: duration,
      lastActivityDate: accountDetails?.lastActivityDate ?? null,
      locationAum: accountDetails?.locationAum ?? null,
    });
    if (ok) {
      // Clear the candidate fields immediately — otherwise they'd still
      // describe a "candidate" identical to the stop we just added,
      // which would register as conflicting with itself.
      setLastScheduledFirmName(firmName.trim() || "Candidate firm");
      setFirmName("");
      setAddress("");
      setCoords(null);
      setAccountId(null);
      setAccountDetails(null);
      setTime("");
    }
  };

  const handleAddToScheduleClick = () => {
    if (verdict === "ok") {
      submitSchedule();
    } else {
      requestConfirm();
    }
  };

  // Mocked stops (dev/no Outlook connection) only ever existed as
  // session-local state, so removing one is just dropping it. Real stops
  // were actually written to the wholesaler's Outlook calendar, so removing
  // one has to delete the real event there too — otherwise it'd just
  // disappear from the app while still sitting on their calendar.
  const handleRemoveStop = async (stop: LoopStop) => {
    if (stop.mockRecord) {
      setAddedStops((prev) => prev.filter((s) => s.id !== stop.id));
      return;
    }

    if (!wholesalerEmail) return;
    if (!window.confirm(`Remove ${stop.firmName} from ${wholesalerName}'s Outlook calendar?`)) return;

    setRemoveError(null);
    setRemovingStopId(stop.id);
    try {
      const res = await fetch("/api/loop/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wholesalerEmail, eventId: stop.sfId ?? stop.id }),
      });
      const result: { success: boolean; error?: string } = await res.json();
      if (result.success) {
        setAddedStops((prev) => prev.filter((s) => s.id !== stop.id));
      } else {
        setRemoveError({ stopId: stop.id, message: result.error ?? "Couldn't remove this visit." });
      }
    } catch (err) {
      console.error("Failed to remove Outlook event:", err);
      setRemoveError({ stopId: stop.id, message: "Network error — please try again." });
    } finally {
      setRemovingStopId(null);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-screen-2xl flex-col gap-6 bg-slate-50 px-6 py-8">
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
          <div className="flex flex-col gap-6">
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
  
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                {wholesalerName ?? "Wholesaler"}&apos;s Timezone
                <select
                  value={timeZone}
                  onChange={(e) => setTimeZone(e.target.value)}
                  className="h-11 rounded-lg border border-slate-300 px-3 font-normal"
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </label>
  
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

            {!outlookLoading && !outlookConnected ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center text-slate-500">
                <span className="text-3xl">📅</span>
                <p className="font-semibold">Connect Outlook to review wholesalers&apos; schedules.</p>
                <a
                  href="/api/auth/microsoft/login"
                  className="mt-2 flex h-11 items-center justify-center rounded-lg bg-brand-teal px-4 text-sm font-bold text-white active:opacity-80"
                >
                  Connect Outlook
                </a>
              </div>
            ) : baseLoop.stops.length === 0 && !candidateResult && preExisting.length === 0 ? (
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
                          <button onClick={clearStaleScheduleState} className="font-bold underline">
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
                              onClick={clearStaleScheduleState}
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
                          <div className="mb-1 flex flex-col gap-1">
                            <div className="flex items-center justify-between gap-2">
                              <p
                                className={`text-xs font-bold uppercase tracking-wide ${
                                  stop.mockRecord ? "text-amber-700" : "text-emerald-700"
                                }`}
                              >
                                {stop.mockRecord ? "Added this session" : "Saved"}
                              </p>
                              <button
                                onClick={() => handleRemoveStop(stop)}
                                disabled={removingStopId === stop.id}
                                className="text-xs font-bold uppercase tracking-wide text-red-600 underline underline-offset-2 disabled:opacity-50"
                              >
                                {removingStopId === stop.id ? "Removing…" : "Remove"}
                              </button>
                            </div>
                            {removeError?.stopId === stop.id && (
                              <p className="text-xs font-medium text-red-600">{removeError.message}</p>
                            )}
                          </div>
                        )}
                        <div className={stop.id === CANDIDATE_ID ? "rounded-2xl ring-2 ring-brand-orange" : ""}>
                          <StopCard stop={stop} />
                        </div>
                        {i < displayLoop.legs.length && !isSameLocation(stop, displayLoop.stops[i + 1]) && (
                          <ConflictBanner
                            leg={displayLoop.legs[i]}
                            fromName={stop.firmName}
                            toName={displayLoop.stops[i + 1].firmName}
                          />
                        )}
                      </div>
                    ))}
                  </div>
  
                  {preExisting.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                        Also on {wholesalerName}&apos;s calendar today
                      </p>
                      {preExisting.map((event) => (
                        <div key={event.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                          <p className="text-sm font-semibold text-slate-800">{event.subject}</p>
                          <p className="text-xs text-slate-500">
                            {formatTime12h(event.start.slice(11, 16))} – {formatTime12h(event.end.slice(11, 16))}
                            {event.location && ` · ${event.location}`}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
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
          </div>

          <div className="lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
            <SuggestedFAs
              wholesalerId={wholesalerId}
              date={date}
              existingStops={existingStops}
              timeZone={timeZone}
              wholesalerEmail={wholesalerEmail}
              setAddedStops={setAddedStops}
            />
          </div>
        </div>
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
export function VerdictPill({ verdict }: { verdict: "ok" | "tight" | "conflict" }) {
  const copy = VERDICT_COPY[verdict];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${copy.pillStyle}`}>
      {copy.icon} {copy.label}
    </span>
  );
}
