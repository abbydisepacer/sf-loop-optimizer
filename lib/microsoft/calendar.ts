import { GRAPH_BASE } from "./auth";
import { formatAddress } from "@/lib/maps-links";
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
};

type GraphEvent = {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName?: string };
  singleValueExtendedProperties?: { id: string; value: string }[];
};

/**
 * Reads a wholesaler's Outlook calendar for a date range, splitting results
 * into stops this app created (tagged with MARKER_PROPERTY_ID, carrying
 * enough info to route them) and everything else already on the calendar
 * (read-only — see the "pre-existing events" decision: many won't have a
 * usable address, so they're shown as informational only, not routed).
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
        });
        continue;
      } catch (err) {
        console.error("Malformed Loop app marker on event", event.id, err);
        // Falls through — shown as a plain pre-existing event instead of dropped.
      }
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
