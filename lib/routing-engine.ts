import type { Leg, LegStatus, LoopStop, ScheduledStop, Loop } from "./types";

/** Buffer thresholds used to classify a leg's feasibility. */
const CONFLICT_BELOW_MINUTES = 0;
const TIGHT_BELOW_MINUTES = 15;

function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Placeholder for the Google Distance Matrix API. Estimates suburban
 * drive time from straight-line distance, average speed, and a fixed
 * overhead for parking/traffic lights. Swapped out for live drive times
 * in the routing-integration step.
 */
export function estimateDrive(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): { miles: number; minutes: number } {
  const miles = haversineMiles(from, to);
  const AVG_SPEED_MPH = 28;
  const FIXED_OVERHEAD_MINUTES = 6;
  const minutes = Math.round((miles / AVG_SPEED_MPH) * 60 + FIXED_OVERHEAD_MINUTES);
  return { miles: Math.round(miles * 10) / 10, minutes };
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function classify(bufferMinutes: number | null): LegStatus {
  if (bufferMinutes === null) return "ok";
  if (bufferMinutes < CONFLICT_BELOW_MINUTES) return "conflict";
  if (bufferMinutes < TIGHT_BELOW_MINUTES) return "tight";
  return "ok";
}

/**
 * Builds a feasible visit order and per-leg drive analysis for one day's
 * loop. Appointment times are treated as fixed constraints: fixed stops
 * are never reordered relative to each other. Stops without a fixed time
 * are slotted into whichever gap between fixed stops has the most slack.
 */
export function buildLoop(stopsForDate: LoopStop[], date: string): Loop {
  const fixed = stopsForDate
    .filter((s) => s.meetingTime !== null)
    .sort((a, b) => timeToMinutes(a.meetingTime as string) - timeToMinutes(b.meetingTime as string));
  const flexible = stopsForDate.filter((s) => s.meetingTime === null);

  const ordered: ScheduledStop[] = fixed.map((s) => ({
    ...s,
    sequence: 0,
    isFlexible: false,
  }));

  for (const flex of flexible) {
    // Evaluate every gap (before first, between each pair, after last) and
    // pick the one with the most slack time for this stop's visit.
    let bestIndex = ordered.length;
    let bestSlack = -Infinity;
    let bestTime: string | null = null;

    for (let i = 0; i <= ordered.length; i++) {
      const prev = ordered[i - 1];
      const next = ordered[i];

      const prevEnd = prev
        ? timeToMinutes(prev.meetingTime ?? prev.suggestedTime!) + prev.durationMinutes
        : null;
      const nextStart = next ? timeToMinutes(next.meetingTime ?? next.suggestedTime!) : null;

      const driveFromPrev = prev ? estimateDrive(prev, flex).minutes : 0;
      const driveToNext = next ? estimateDrive(flex, next).minutes : 0;

      const earliestArrival = prevEnd !== null ? prevEnd + driveFromPrev : 0;
      const latestDeparture = nextStart !== null ? nextStart - driveToNext : Infinity;
      const slack = latestDeparture - earliestArrival - flex.durationMinutes;

      if (slack > bestSlack) {
        bestSlack = slack;
        bestIndex = i;
        bestTime = minutesToTime(earliestArrival);
      }
    }

    ordered.splice(bestIndex, 0, {
      ...flex,
      sequence: 0,
      isFlexible: true,
      suggestedTime: bestTime ?? undefined,
    });
  }

  ordered.forEach((s, i) => (s.sequence = i + 1));

  const legs: Leg[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i];
    const to = ordered[i + 1];
    const { miles, minutes } = estimateDrive(from, to);

    const fromEnd = from.meetingTime ?? from.suggestedTime;
    const toStart = to.meetingTime ?? to.suggestedTime;
    const availableMinutes =
      fromEnd && toStart
        ? timeToMinutes(toStart) - (timeToMinutes(fromEnd) + from.durationMinutes)
        : null;
    const bufferMinutes = availableMinutes !== null ? availableMinutes - minutes : null;

    legs.push({
      fromStopId: from.id,
      toStopId: to.id,
      driveMinutes: minutes,
      driveMiles: miles,
      availableMinutes,
      bufferMinutes,
      status: classify(bufferMinutes),
      source: "estimate",
    });
  }

  return { date, stops: ordered, legs };
}
