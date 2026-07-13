import { GRAPH_BASE } from "./auth";
import { formatAddress } from "@/lib/maps-links";
import { geocodeAddress } from "@/lib/google-geocode";
import type { ScheduleVisitInput, ScheduleVisitResult } from "@/lib/salesforce/loop-write";
import type { LoopStop, Address } from "@/lib/types";

// Fixed GUID identifying "this event was created by the Loop app" — tags
// every event we create so a later read can tell it apart from whatever
// else is already on the external's calendar. Not a secret; just needs to
// be stable and unlikely to collide with another app's extended property.
const MARKER_PROPERTY_ID = "String {6a1e6e64-4b0b-4b7a-9b3a-2f7e6c9a1d10} Name LoopAppVisit";

export type PreExistingEvent = {
  id: string;
  subject: string;
  /** ISO local datetime, in the calendar's own timezone (see the Prefer header below). */
  start: string;
  end: string;
  location: string;
};

/** Everything needed to reconstruct a full, routable LoopStop on read-back. */
type MarkerPayload = {
  firmName: string;
  address: Address;
  lat: number;
  lng: number;
  durationMinutes: number;
  /** Salesforce Account Id, if this visit was linked to one — lets a later read re-fetch fresh Last Activity Date / Location AUM. */
  accountId?: string;
};

type GraphEvent = {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: {
    displayName?: string;
    address?: { street?: string; city?: string; state?: string; postalCode?: string };
    coordinates?: { latitude?: number; longitude?: number };
  };
  singleValueExtendedProperties?: { id: string; value: string }[];
};

const STREET_SUFFIXES =
  "st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|cir|circle|hwy|highway|pkwy|parkway|ter|terrace|sq|square|trl|trail|loop";
// A street number/name followed by a recognized street-type word, anywhere
// in the text — not just at the very start, since real event locations are
// often written like "Client Office, 123 Main St" or "ABC Corp - 4500
// Market St, Suite 400", not as a bare address.
const STREET_ADDRESS_PATTERN = new RegExp(
  `\\b\\d{1,6}\\s+[A-Za-z0-9.'-]+(?:\\s+[A-Za-z0-9.'-]+){0,5}\\s+(?:${STREET_SUFFIXES})\\b`,
  "i"
);
// Catches addresses without a recognizable street-type word at all (e.g.
// "500 Broadway, New York, NY 10012") via the trailing "City, ST ZIP" tail
// instead, which is just as strong a signal that this is a real address.
const CITY_STATE_ZIP_PATTERN = /,\s*[A-Za-z]{2}\s+\d{5}(-\d{4})?\b/;

/**
 * A conservative filter for whether a pre-existing event's free-text
 * location is worth geocoding at all. Without this, generic labels such as
 * "Teams Meeting", "Conference Room A", or "Zoom" would still return SOME
 * plausible-looking (but wrong) nearby place from a fuzzy text search,
 * routing the wholesaler to a location they were never actually going to —
 * neither pattern here matches text like that.
 */
function looksLikeStreetAddress(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  return STREET_ADDRESS_PATTERN.test(trimmed) || CITY_STATE_ZIP_PATTERN.test(trimmed);
}

/** Minutes between two same-day local "YYYY-MM-DDTHH:mm:ss" wall-clock strings. */
function minutesBetween(startIso: string, endIso: string): number {
  const toMinutes = (iso: string) => {
    const [h, m] = iso.slice(11, 16).split(":").map(Number);
    return h * 60 + m;
  };
  return toMinutes(endIso) - toMinutes(startIso);
}

/**
 * Resolves a real, routable location for a pre-existing (non-app-created)
 * calendar event, if one is available — either structured coordinates
 * Outlook already stored for the location (most reliable, no extra API
 * call), or a geocode of the free-text location if it looks like an actual
 * street address. Returns null if neither is available, meaning the event
 * stays a read-only "also on the calendar" card instead of a routed stop.
 */
async function resolveEventLocation(
  location: GraphEvent["location"]
): Promise<{ address: Address; lat: number; lng: number } | null> {
  if (!location) return null;

  if (typeof location.coordinates?.latitude === "number" && typeof location.coordinates?.longitude === "number") {
    const a = location.address;
    return {
      address: {
        street: a?.street ?? location.displayName ?? "",
        city: a?.city ?? "",
        state: a?.state ?? "",
        zip: a?.postalCode ?? "",
      },
      lat: location.coordinates.latitude,
      lng: location.coordinates.longitude,
    };
  }

  const text = location.displayName?.trim();
  if (!text || !looksLikeStreetAddress(text)) return null;

  const geocoded = await geocodeAddress(text).catch((err) => {
    console.error("Failed to geocode pre-existing event location:", err);
    return null;
  });
  if (!geocoded) return null;

  return {
    address: { street: geocoded.formattedAddress, city: "", state: "", zip: "" },
    lat: geocoded.lat,
    lng: geocoded.lng,
  };
}

/**
 * Reads a wholesaler's Outlook calendar for a date range, splitting results
 * into routable stops and read-only pre-existing events. A stop is either
 * one this app created (tagged with MARKER_PROPERTY_ID, carrying enough
 * info to route them), or a pre-existing event whose location resolved to
 * a real address (see resolveEventLocation) — both flow into the same
 * `stops` array, so buildLoop places pre-existing meetings in their correct
 * chronological position and renumbers everything around them, same as any
 * other stop. Everything else (no usable address) stays a plain read-only
 * card, per the original "many pre-existing events won't have a usable
 * address" decision — just narrowed to only the events that actually don't.
 * `timeZone` controls what zone times come back in — the caller's own
 * browser zone for an external reading their own calendar, or a zone the
 * internal wholesaler picked manually for someone else's (Graph has no
 * reliable way to look up a different mailbox's timezone); "UTC" is a
 * reasonable degraded fallback either way.
 */
export async function getCalendarEvents(
  accessToken: string,
  upn: string,
  wholesalerId: string,
  startIso: string,
  endIso: string,
  timeZone: string
): Promise<{ stops: LoopStop[]; preExisting: PreExistingEvent[] }> {
  const params = new URLSearchParams({
    startDateTime: startIso,
    endDateTime: endIso,
    $expand: `singleValueExtendedProperties($filter=id eq '${MARKER_PROPERTY_ID}')`,
    $orderby: "start/dateTime",
    $top: "50",
  });

  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(upn)}/calendarView?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `outlook.timezone="${timeZone}"`,
    },
  });
  if (!res.ok) {
    throw new Error(`Microsoft calendar read failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const events: GraphEvent[] = data.value ?? [];

  const stops: LoopStop[] = [];
  const preExisting: PreExistingEvent[] = [];

  for (const event of events) {
    const marker = event.singleValueExtendedProperties?.find((p) => p.id === MARKER_PROPERTY_ID);
    if (marker) {
      try {
        const payload: MarkerPayload = JSON.parse(marker.value);
        stops.push({
          id: event.id,
          sfId: event.id,
          wholesalerId,
          firmName: payload.firmName,
          address: payload.address,
          lat: payload.lat,
          lng: payload.lng,
          meetingDate: event.start.dateTime.slice(0, 10),
          meetingTime: event.start.dateTime.slice(11, 16),
          durationMinutes: payload.durationMinutes,
          accountId: payload.accountId,
        });
        continue;
      } catch (err) {
        console.error("Malformed Loop app marker on event", event.id, err);
        // Falls through — resolved as a plain event instead of dropped.
      }
    }

    const resolved = await resolveEventLocation(event.location);
    if (resolved) {
      stops.push({
        id: event.id,
        sfId: event.id,
        wholesalerId,
        firmName: event.subject || "Calendar event",
        address: resolved.address,
        lat: resolved.lat,
        lng: resolved.lng,
        meetingDate: event.start.dateTime.slice(0, 10),
        meetingTime: event.start.dateTime.slice(11, 16),
        durationMinutes: minutesBetween(event.start.dateTime, event.end.dateTime),
        fromCalendarEvent: true,
      });
      continue;
    }

    preExisting.push({
      id: event.id,
      subject: event.subject,
      start: event.start.dateTime,
      end: event.end.dateTime,
      location: event.location?.displayName ?? "",
    });
  }

  return { stops, preExisting };
}

/** Adds minutes to a local "YYYY-MM-DDTHH:mm:00" wall-clock string, correctly rolling over past midnight. */
function addMinutesToLocalDateTime(dateIso: string, time: string, minutes: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  // Date.UTC here is just a neutral clock for calendar arithmetic — this
  // value is never sent anywhere or treated as a real UTC instant.
  const result = new Date(Date.UTC(year, month - 1, day, hour, minute) + minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}T${pad(
    result.getUTCHours()
  )}:${pad(result.getUTCMinutes())}:00`;
}

/**
 * Creates a real event directly on the external wholesaler's Outlook
 * calendar. `timeZone` is whatever the internal wholesaler picked in the UI
 * for this wholesaler — there's no reliable way to look up someone else's
 * mailbox timezone via Graph, and a wrong one here means a real meeting
 * lands at the wrong wall-clock time on their actual calendar. Graph
 * accepts an IANA or Windows timezone name alongside a plain wall-clock
 * dateTime, so — unlike the retired Salesforce Event path — no manual
 * UTC/DST conversion is needed.
 */
export async function createCalendarEvent(
  accessToken: string,
  upn: string,
  input: ScheduleVisitInput,
  timeZone: string
): Promise<ScheduleVisitResult> {
  const startDateTime = `${input.meetingDate}T${input.meetingTime}:00`;
  const endDateTime = addMinutesToLocalDateTime(input.meetingDate, input.meetingTime, input.durationMinutes);

  const marker: MarkerPayload = {
    firmName: input.firmName,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    durationMinutes: input.durationMinutes,
    accountId: input.accountId ?? undefined,
  };

  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(upn)}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subject: `Wholesaler Loop Visit: ${input.firmName}`,
      location: { displayName: formatAddress(input.address) },
      start: { dateTime: startDateTime, timeZone },
      end: { dateTime: endDateTime, timeZone },
      singleValueExtendedProperties: [{ id: MARKER_PROPERTY_ID, value: JSON.stringify(marker) }],
    }),
  });

  if (!res.ok) {
    console.error(`Microsoft event creation failed (${res.status}):`, await res.text());
    return { success: false, error: "Outlook couldn't save this visit — try again." };
  }

  const result = await res.json();
  return { success: true, recordId: result.id, mocked: false };
}

/** Deletes a real event this app created, in case a visit was added by mistake. */
export async function deleteCalendarEvent(
  accessToken: string,
  upn: string,
  eventId: string
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(upn)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 404 is treated as success — the event is already gone from the
  // wholesaler's calendar either way, which is what the caller cares about.
  if (!res.ok && res.status !== 404) {
    console.error(`Microsoft event deletion failed (${res.status}):`, await res.text());
    return { success: false, error: "Outlook couldn't remove this visit — try again." };
  }

  return { success: true };
}
