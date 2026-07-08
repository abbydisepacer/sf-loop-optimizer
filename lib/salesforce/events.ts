import { SALESFORCE_API_VERSION } from "./auth";
import { formatAddress } from "@/lib/maps-links";
import type { ScheduleVisitInput, ScheduleVisitResult } from "./loop-write";

/**
 * IANA timezone assumed for every wholesaler's meeting times, since the app
 * has no per-user timezone selection yet. Required before real Salesforce
 * Events are created — without it, writes stay on the mocked path rather
 * than risk recording a visit at the wrong wall-clock time on someone's
 * real calendar.
 */
function eventTimeZone(): string | null {
  return process.env.SALESFORCE_EVENT_TIMEZONE || null;
}

export function isRealEventWriteConfigured(): boolean {
  return Boolean(eventTimeZone());
}

/**
 * Converts a local wall-clock date+time in `timeZone` to a UTC ISO 8601
 * instant. Measures how far that timezone's clock reads from a trial UTC
 * instant and corrects by the difference, which accounts for DST without
 * needing a fixed offset or an external timezone-data library.
 */
function toUtcIso(dateIso: string, time: string, timeZone: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  const trialUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(trialUtcMs)).map((p) => [p.type, p.value]));
  const readAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMs = readAsUtcMs - trialUtcMs;
  return new Date(trialUtcMs - offsetMs).toISOString();
}

/**
 * Records a scheduled visit as a standard Salesforce Event — Owner is the
 * External Wholesaler (shows on their calendar), WhatId links it to the
 * Account when the firm is an existing one, and Location carries the
 * address for prospective firms that aren't an Account yet.
 */
export async function createVisitEvent(
  accessToken: string,
  instanceUrl: string,
  input: ScheduleVisitInput
): Promise<ScheduleVisitResult> {
  const timeZone = eventTimeZone();
  if (!timeZone) {
    throw new Error("SALESFORCE_EVENT_TIMEZONE is not set — required for real Event writes.");
  }

  const startIso = toUtcIso(input.meetingDate, input.meetingTime, timeZone);
  const endIso = new Date(new Date(startIso).getTime() + input.durationMinutes * 60_000).toISOString();

  const body: Record<string, unknown> = {
    OwnerId: input.wholesalerId,
    Subject: `Wholesaler Loop Visit: ${input.firmName}`,
    Location: formatAddress(input.address),
    StartDateTime: startIso,
    EndDateTime: endIso,
  };
  if (input.accountId) {
    body.WhatId = input.accountId;
  }

  const res = await fetch(`${instanceUrl}/services/data/${SALESFORCE_API_VERSION}/sobjects/Event`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`Salesforce Event creation failed (${res.status}):`, await res.text());
    return { success: false, error: "Salesforce couldn't save this visit — try again." };
  }

  const result = await res.json();
  return { success: true, recordId: result.id, mocked: false };
}
