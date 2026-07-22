import { buildLoop, estimateDrive } from "./routing-engine";
import type { LoopStop, LegStatus } from "./types";

const CANDIDATE_ID = "__candidate__";

const VERDICT_RANK: Record<LegStatus, number> = { ok: 0, tight: 1, conflict: 2 };

// Suggested meetings are only ever placed within a typical work day — never
// before 9am or after 5pm, regardless of how much open time the schedule
// has outside that window.
const WORK_DAY_START_MINUTES = 9 * 60;
const WORK_DAY_END_MINUTES = 17 * 60;

export type PlacementResult = {
  /** "HH:mm" slot the candidate ended up at, or null if no slot within the work day fit at all. */
  suggestedTime: string | null;
  verdict: LegStatus;
};

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function readPlacement(loop: ReturnType<typeof buildLoop>): PlacementResult {
  const index = loop.stops.findIndex((s) => s.id === CANDIDATE_ID);
  if (index === -1) return { suggestedTime: null, verdict: "ok" };

  const placed = loop.stops[index];
  const incomingLeg = index > 0 ? loop.legs[index - 1] : null;
  const outgoingLeg = index < loop.stops.length - 1 ? loop.legs[index] : null;
  const statuses = [incomingLeg?.status, outgoingLeg?.status].filter(Boolean) as LegStatus[];

  const verdict: LegStatus = statuses.includes("conflict")
    ? "conflict"
    : statuses.includes("tight")
      ? "tight"
      : "ok";

  return { suggestedTime: placed.meetingTime ?? placed.suggestedTime ?? null, verdict };
}

/**
 * Finds the best 9am–5pm slot for a candidate stop against a day's existing
 * stops, and reads back a fit verdict — used by the Suggested FAs feature
 * (lib/salesforce/fa-suggestions.ts, lib/mock-fa-suggestions.ts), which
 * places many candidates, one at a time, independently of each other.
 *
 * Deliberately does NOT reuse buildLoop's own flexible-stop auto-placement
 * (meetingTime: null) — that algorithm always favors whichever gap has the
 * most slack, which is frequently the open stretch before the first
 * appointment or after the last one, with no upper/lower bound at all. That
 * can land a suggestion at midnight, or past a late evening stop, which
 * isn't a real work-day option. Instead, every gap in the day (before the
 * first stop, between each pair, after the last) is evaluated directly and
 * clamped to the 9–5 window. Every trial in that bounded set is sane, so
 * unlike the earlier unbounded approach, it's safe to search all of them for
 * the best verdict (ok > tight > conflict) rather than settling for the
 * first non-conflict slot found.
 */
export function placeCandidate(
  existingStops: LoopStop[],
  candidate: Omit<LoopStop, "id">,
  date: string
): PlacementResult {
  const dayStops = buildLoop(existingStops, date).stops;

  const trials: { time: string; slack: number }[] = [];
  for (let i = 0; i <= dayStops.length; i++) {
    const prev = dayStops[i - 1];
    const next = dayStops[i];
    const prevEnd = prev ? timeToMinutes(prev.meetingTime ?? prev.suggestedTime!) + prev.durationMinutes : null;
    const nextStart = next ? timeToMinutes(next.meetingTime ?? next.suggestedTime!) : null;

    const driveFromPrev = prev ? estimateDrive(prev, candidate).minutes : 0;
    const driveToNext = next ? estimateDrive(candidate, next).minutes : 0;

    // Clamped to the work day at both ends — a big empty morning never
    // pushes the earliest option before 9am, and a gap that runs past 5pm
    // never gets treated as available beyond that.
    const earliestArrival = Math.max(
      prevEnd !== null ? prevEnd + driveFromPrev : WORK_DAY_START_MINUTES,
      WORK_DAY_START_MINUTES
    );
    const latestDeparture = Math.min(
      nextStart !== null ? nextStart - driveToNext : WORK_DAY_END_MINUTES,
      WORK_DAY_END_MINUTES
    );

    if (earliestArrival + candidate.durationMinutes > WORK_DAY_END_MINUTES) continue; // wouldn't finish within the work day
    if (nextStart !== null && earliestArrival >= nextStart) continue; // no room before the next appointment starts
    if (latestDeparture < earliestArrival) continue; // this gap doesn't overlap the work day at all

    const slack = latestDeparture - earliestArrival - candidate.durationMinutes;

    // Where within the gap to start matters: parking at the earliest instant
    // pins the buffer against the previous stop to exactly 0 (always "tight"),
    // even when the gap has hours of slack. Center the appointment when both
    // sides are real appointments (splitting the slack maximizes the smaller
    // of the two buffers); when only one side is a real appointment, push all
    // the way to the far edge from it instead, since the other side has no
    // leg to keep a buffer against.
    let start: number;
    if (prevEnd !== null && nextStart !== null) {
      start = earliestArrival + Math.floor(slack / 2);
    } else if (prevEnd !== null) {
      start = latestDeparture - candidate.durationMinutes;
    } else {
      start = earliestArrival;
    }

    trials.push({ time: minutesToTime(start), slack });
  }

  if (trials.length === 0) {
    // No gap in the day even overlaps 9am–5pm — genuinely nowhere to put it.
    return { suggestedTime: null, verdict: "conflict" };
  }

  // Most-open gap (within the work day) first, so that among trials tied on
  // verdict, the one with the most slack wins by being seen first.
  trials.sort((a, b) => b.slack - a.slack);

  let best: PlacementResult | null = null;
  for (const trial of trials) {
    const fixedCandidate: LoopStop = { ...candidate, id: CANDIDATE_ID, meetingTime: trial.time };
    const result = readPlacement(buildLoop([...existingStops, fixedCandidate], date));
    if (result.verdict === "ok") return result; // nothing beats "ok" — stop searching
    if (!best || VERDICT_RANK[result.verdict] < VERDICT_RANK[best.verdict]) best = result;
  }

  return best!;
}

/**
 * Reads back just the fit verdict (ok/tight/conflict) for a candidate
 * already pinned to a specific time and duration — used to re-check a
 * Suggested FA row after the internal wholesaler edits its Time or
 * Duration in the UI, since those edits invalidate the verdict
 * `placeCandidate` computed for the original suggested time/duration.
 * Unlike `placeCandidate`, this never searches for a better slot; it just
 * scores the one the caller asked about.
 */
export function verdictForFixedTime(
  existingStops: LoopStop[],
  candidate: Omit<LoopStop, "id"> & { meetingTime: string },
  date: string
): LegStatus {
  const fixedCandidate: LoopStop = { ...candidate, id: CANDIDATE_ID };
  return readPlacement(buildLoop([...existingStops, fixedCandidate], date)).verdict;
}
