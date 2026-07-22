import { escapeSoql, runQuery } from "./query";
import { findContactsNearLocation, type ContactSearchResult } from "./contacts";
import { placeCandidate } from "@/lib/candidate-placement";
import { todayIso } from "@/lib/format";
import type { LoopStop, LegStatus } from "@/lib/types";

const MEETING_ACTIVITY_OBJECT = process.env.SALESFORCE_MEETING_ACTIVITY_OBJECT || "Event";
const MEETING_ACTIVITY_TYPE = process.env.SALESFORCE_MEETING_ACTIVITY_TYPE;
const DROPIN_ACTIVITY_TYPE = process.env.SALESFORCE_DROPIN_ACTIVITY_TYPE;

const PRIORITY_LIST_WEIGHTS: Record<string, number> | null = (() => {
  const raw = process.env.SALESFORCE_PRIORITY_LIST_WEIGHTS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    console.warn("SALESFORCE_PRIORITY_LIST_WEIGHTS is not valid JSON — priority-list boost disabled.");
    return null;
  }
})();

const SHARE_COUNT_AUM_THRESHOLD = process.env.SALESFORCE_SHARE_COUNT_AUM_THRESHOLD
  ? Number(process.env.SALESFORCE_SHARE_COUNT_AUM_THRESHOLD)
  : null;

const AUM_HISTORY_OBJECT = process.env.SALESFORCE_AUM_HISTORY_OBJECT;
const AUM_SNAPSHOT_DATE_FIELD = process.env.SALESFORCE_AUM_SNAPSHOT_DATE_FIELD;
const AUM_SNAPSHOT_VALUE_FIELD = process.env.SALESFORCE_AUM_SNAPSHOT_VALUE_FIELD;
const AUM_SNAPSHOT_ACCOUNT_FIELD = process.env.SALESFORCE_AUM_SNAPSHOT_ACCOUNT_FIELD;
const AUM_HISTORY_CONFIGURED = Boolean(
  AUM_HISTORY_OBJECT && AUM_SNAPSHOT_DATE_FIELD && AUM_SNAPSHOT_VALUE_FIELD && AUM_SNAPSHOT_ACCOUNT_FIELD
);

export type SuggestionConfigFlags = {
  cadence: boolean;
  priorityLists: boolean;
  aumHistory: boolean;
  dropIn: boolean;
  excludeStatus: boolean;
  shareAdjustment: boolean;
  bigCalendarTiebreak: boolean;
  locationAum: boolean;
};

export function getSuggestionConfigFlags(): SuggestionConfigFlags {
  return {
    cadence: Boolean(process.env.SALESFORCE_CADENCE_FIELD),
    priorityLists: Boolean(process.env.SALESFORCE_PRIORITY_LIST_FIELD && PRIORITY_LIST_WEIGHTS),
    aumHistory: AUM_HISTORY_CONFIGURED,
    dropIn: Boolean(DROPIN_ACTIVITY_TYPE),
    excludeStatus: Boolean(
      process.env.SALESFORCE_EXCLUDE_STATUS_FIELD && process.env.SALESFORCE_EXCLUDE_STATUS_VALUES
    ),
    shareAdjustment: Boolean(process.env.SALESFORCE_SHARE_ADJUSTMENT_FIELD),
    bigCalendarTiebreak: Boolean(process.env.SALESFORCE_BIG_CALENDAR_FIELD),
    locationAum: Boolean(process.env.SALESFORCE_LOCATION_AUM_FIELD),
  };
}

export type SuggestionFilters = {
  /** Fully user-controlled — no enforced floor. Default is 75 (a real meeting within that window is normally "not due"), but it can be set to anything, including 0. */
  minDaysSinceLastMeeting: number;
  radiusMiles: number;
  /** Include the 200–399 day "faded" tier. */
  includeFaded: boolean;
  /** Include the 400+ day "prospect" tier. */
  includeProspect: boolean;
  /** No-ops (nothing excluded) unless SALESFORCE_PRIORITY_LIST_FIELD is configured. */
  priorityListsOnly: boolean;
  /** Optional — 0 (the default) means no floor. No-op unless SALESFORCE_LOCATION_AUM_FIELD is configured. */
  minLocationAum: number;
};

export const DEFAULT_SUGGESTION_FILTERS: SuggestionFilters = {
  minDaysSinceLastMeeting: 75,
  radiusMiles: 25,
  includeFaded: true,
  includeProspect: false,
  priorityListsOnly: false,
  minLocationAum: 0,
};

export const DEFAULT_SUGGESTION_DURATION_MINUTES = 30;

export type ScoreBreakdown = {
  tier: "active" | "faded" | "prospect";
  base: number;
  boosts: { label: string; amount: number }[];
  total: number;
  flags: { edwardJones: boolean; ameripriseCallOnly: boolean; shareCountRedFlag: boolean };
};

export type FaSuggestion = {
  contact: ContactSearchResult;
  daysSinceLastMeeting: number;
  meetingCount: number;
  score: ScoreBreakdown;
  suggestedTime: string | null;
  durationMinutes: number;
  verdict: LegStatus;
};

const ACTIVE_MAX_DAYS = 200;
const FADED_MAX_DAYS = 400;

const ACTIVE_BASE = 100;
const FADED_BASE = 40;
const PROSPECT_BASE = 10;

const MEETING_COUNT_PER_MEETING = 3;
const MEETING_COUNT_CAP = 30;
const CADENCE_BOOST_CAP = 30;
const DROP_IN_BOOST = 60;
const WIN_BACK_BOOST = 70;
const SUSTAINED_DECLINE_BOOST = 25;
const ONE_TIME_DECLINE_BOOST = 20;
const SUSTAINED_GROWTH_BOOST = 15;
const ONE_TIME_GROWTH_BOOST = 12;
const ONE_TIME_MOVE_THRESHOLD = 300_000;
const NEAR_ZERO_RATIO = 0.05;
const RECENT_DROPIN_MAX_DAYS = 40;
const MEETING_MERGE_WINDOW_DAYS = 30;
const ACTIVITY_LOOKBACK_DAYS = 450;
const MAX_SUGGESTIONS = 50;

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

function tierFor(days: number): "active" | "faded" | "prospect" {
  if (days < ACTIVE_MAX_DAYS) return "active";
  if (days < FADED_MAX_DAYS) return "faded";
  return "prospect";
}

type ActivityRecord = { WhoId: string; ActivityDate: string; Type: string | null };

async function fetchMeetingActivity(
  accessToken: string,
  instanceUrl: string,
  contactIds: string[]
): Promise<Map<string, ActivityRecord[]>> {
  const map = new Map<string, ActivityRecord[]>();
  if (contactIds.length === 0) return map;

  const idList = contactIds.map((id) => `'${escapeSoql(id)}'`).join(",");
  const typeClause = MEETING_ACTIVITY_TYPE ? ` AND Type = '${escapeSoql(MEETING_ACTIVITY_TYPE)}'` : "";
  const soql =
    `SELECT WhoId, ActivityDate, Type FROM ${MEETING_ACTIVITY_OBJECT} ` +
    `WHERE WhoId IN (${idList}) AND ActivityDate = LAST_N_DAYS:${ACTIVITY_LOOKBACK_DAYS}${typeClause} ` +
    `ORDER BY ActivityDate DESC`;

  const records = await runQuery<ActivityRecord>(accessToken, instanceUrl, soql);
  for (const r of records) {
    if (!r.WhoId) continue;
    const list = map.get(r.WhoId) ?? [];
    list.push(r);
    map.set(r.WhoId, list);
  }
  return map;
}

/**
 * "Meeting already booked" suppression — only sees future records on
 * MEETING_ACTIVITY_OBJECT. Known v1 gap: this app's real scheduling path
 * writes to the wholesaler's Outlook calendar (see lib/salesforce/loop-write.ts),
 * not a Salesforce Event, so a meeting booked purely through this app won't
 * suppress a re-suggestion here.
 */
async function fetchFutureBooked(
  accessToken: string,
  instanceUrl: string,
  contactIds: string[]
): Promise<Set<string>> {
  const set = new Set<string>();
  if (contactIds.length === 0) return set;

  const idList = contactIds.map((id) => `'${escapeSoql(id)}'`).join(",");
  const futureClause = MEETING_ACTIVITY_OBJECT === "Task" ? "ActivityDate >= TODAY" : "StartDateTime > NOW()";
  const soql = `SELECT WhoId FROM ${MEETING_ACTIVITY_OBJECT} WHERE WhoId IN (${idList}) AND ${futureClause}`;

  const records = await runQuery<{ WhoId: string }>(accessToken, instanceUrl, soql);
  records.forEach((r) => r.WhoId && set.add(r.WhoId));
  return set;
}

type AumSignals = {
  winBack: boolean;
  sustainedDecline: boolean;
  oneTimeDecline: boolean;
  sustainedGrowth: boolean;
  oneTimeGrowth: boolean;
};

/**
 * Best-effort AUM snapshot analysis — entirely skipped unless all four
 * SALESFORCE_AUM_SNAPSHOT_... and SALESFORCE_AUM_HISTORY_OBJECT env vars are
 * set, since the snapshot object's exact shape isn't confirmed for this org.
 */
async function fetchAumSignals(
  accessToken: string,
  instanceUrl: string,
  accountIds: string[]
): Promise<Map<string, AumSignals>> {
  const result = new Map<string, AumSignals>();
  if (!AUM_HISTORY_CONFIGURED || accountIds.length === 0) return result;

  const idList = accountIds.map((id) => `'${escapeSoql(id)}'`).join(",");
  const soql =
    `SELECT ${AUM_SNAPSHOT_ACCOUNT_FIELD}, ${AUM_SNAPSHOT_DATE_FIELD}, ${AUM_SNAPSHOT_VALUE_FIELD} ` +
    `FROM ${AUM_HISTORY_OBJECT} WHERE ${AUM_SNAPSHOT_ACCOUNT_FIELD} IN (${idList}) ` +
    `ORDER BY ${AUM_SNAPSHOT_ACCOUNT_FIELD}, ${AUM_SNAPSHOT_DATE_FIELD} DESC`;

  const records = await runQuery<Record<string, unknown>>(accessToken, instanceUrl, soql);

  const byAccount = new Map<string, number[]>();
  for (const r of records) {
    const acctId = r[AUM_SNAPSHOT_ACCOUNT_FIELD!] as string | null;
    const value = r[AUM_SNAPSHOT_VALUE_FIELD!];
    if (!acctId || typeof value !== "number") continue;
    const list = byAccount.get(acctId) ?? [];
    list.push(value); // already DESC by date — list[0] is the latest snapshot
    byAccount.set(acctId, list);
  }

  for (const [acctId, values] of byAccount) {
    const latest = values[0];
    const previous = values[1];
    const peak = Math.max(...values);
    result.set(acctId, {
      winBack: peak > 0 && latest <= peak * NEAR_ZERO_RATIO,
      sustainedDecline: values.length >= 3 && values[0] < values[1] && values[1] < values[2],
      oneTimeDecline: previous !== undefined && previous - latest > ONE_TIME_MOVE_THRESHOLD,
      sustainedGrowth: values.length >= 3 && values[0] > values[1] && values[1] > values[2],
      oneTimeGrowth: previous !== undefined && latest - previous > ONE_TIME_MOVE_THRESHOLD,
    });
  }
  return result;
}

function summarizeActivity(
  rows: ActivityRecord[],
  today: string
): { daysSinceLastMeeting: number | null; meetingCount: number; hasRecentDropIn: boolean } {
  const real = DROPIN_ACTIVITY_TYPE ? rows.filter((r) => r.Type !== DROPIN_ACTIVITY_TYPE) : rows;
  const dropIns = DROPIN_ACTIVITY_TYPE ? rows.filter((r) => r.Type === DROPIN_ACTIVITY_TYPE) : [];

  // Rows are already ORDER BY ActivityDate DESC from the query.
  const realDates = real.map((r) => r.ActivityDate);
  const daysSinceLastMeeting = realDates.length > 0 ? daysBetween(realDates[0], today) : null;

  // "Two meetings within 30 days = one event."
  let meetingCount = 0;
  let lastCounted: string | null = null;
  for (const d of realDates) {
    if (lastCounted === null || daysBetween(d, lastCounted) > MEETING_MERGE_WINDOW_DAYS) {
      meetingCount++;
      lastCounted = d;
    }
  }

  const hasRecentDropIn = dropIns.some((r) => daysBetween(r.ActivityDate, today) <= RECENT_DROPIN_MAX_DAYS);

  return { daysSinceLastMeeting, meetingCount, hasRecentDropIn };
}

/** Pure, I/O-free — unit-testable independent of any Salesforce call. Returns null when the contact should be suppressed entirely. */
export function scoreContact(
  contact: ContactSearchResult,
  activity: {
    daysSinceLastMeeting: number | null;
    meetingCount: number;
    hasRecentDropIn: boolean;
    hasFutureBookedMeeting: boolean;
  },
  filters: SuggestionFilters,
  aum: AumSignals | undefined
): ScoreBreakdown | null {
  const { daysSinceLastMeeting, meetingCount, hasRecentDropIn, hasFutureBookedMeeting } = activity;

  // Never-met contacts are out of scope for v1 — this is a "due for a call"
  // list for existing relationships, not a cold-prospecting list.
  if (daysSinceLastMeeting === null) return null;
  if (daysSinceLastMeeting < filters.minDaysSinceLastMeeting) return null;
  if (hasFutureBookedMeeting) return null;

  const tier = tierFor(daysSinceLastMeeting);
  if (tier === "faded" && !filters.includeFaded) return null;
  if (tier === "prospect" && !filters.includeProspect) return null;
  if (filters.priorityListsOnly && !contact.priorityListValue) return null;

  if (filters.minLocationAum > 0 && (contact.locationAum === null || contact.locationAum < filters.minLocationAum)) {
    return null;
  }

  const base = tier === "active" ? ACTIVE_BASE : tier === "faded" ? FADED_BASE : PROSPECT_BASE;
  const boosts: { label: string; amount: number }[] = [];

  const meetingBoost = Math.min(MEETING_COUNT_CAP, meetingCount * MEETING_COUNT_PER_MEETING);
  if (meetingBoost > 0) boosts.push({ label: "Meeting history", amount: meetingBoost });

  if (contact.cadenceDays !== null && contact.cadenceDays > 0 && daysSinceLastMeeting > contact.cadenceDays) {
    const overshoot = Math.min(
      CADENCE_BOOST_CAP,
      Math.round(((daysSinceLastMeeting - contact.cadenceDays) / contact.cadenceDays) * CADENCE_BOOST_CAP)
    );
    if (overshoot > 0) boosts.push({ label: "Past typical cadence", amount: overshoot });
  }

  if (hasRecentDropIn) boosts.push({ label: "Recent drop-in", amount: DROP_IN_BOOST });

  if (contact.priorityListValue && PRIORITY_LIST_WEIGHTS) {
    const weight = PRIORITY_LIST_WEIGHTS[contact.priorityListValue];
    if (weight) boosts.push({ label: `Priority list: ${contact.priorityListValue}`, amount: weight });
  }

  if (aum) {
    if (aum.winBack) boosts.push({ label: "Win-back", amount: WIN_BACK_BOOST });
    if (aum.sustainedDecline) boosts.push({ label: "Sustained decline", amount: SUSTAINED_DECLINE_BOOST });
    if (aum.oneTimeDecline) boosts.push({ label: "One-time decline >$300k", amount: ONE_TIME_DECLINE_BOOST });
    if (aum.sustainedGrowth) boosts.push({ label: "Sustained growth", amount: SUSTAINED_GROWTH_BOOST });
    if (aum.oneTimeGrowth) boosts.push({ label: "One-time growth >$300k", amount: ONE_TIME_GROWTH_BOOST });
  }

  const total = base + boosts.reduce((sum, b) => sum + b.amount, 0);

  const accountNameLower = contact.accountName.toLowerCase();
  const shareCountRedFlag =
    (SHARE_COUNT_AUM_THRESHOLD !== null &&
      meetingCount >= 3 &&
      contact.locationAum !== null &&
      contact.locationAum < SHARE_COUNT_AUM_THRESHOLD) ||
    Boolean(contact.shareAdjustmentValue);

  return {
    tier,
    base,
    boosts,
    total,
    flags: {
      edwardJones: accountNameLower.includes("edward jones"),
      ameripriseCallOnly: accountNameLower.includes("ameriprise"),
      shareCountRedFlag,
    },
  };
}

function dedupeByAccount<T extends { contact: ContactSearchResult; score: ScoreBreakdown }>(items: T[]): T[] {
  const byAccount = new Map<string, T>();
  for (const item of items) {
    const existing = byAccount.get(item.contact.accountId);
    if (!existing || item.score.total > existing.score.total) {
      byAccount.set(item.contact.accountId, item);
    }
  }
  return Array.from(byAccount.values());
}

/**
 * Best match first: Edward Jones contacts are partitioned to the bottom
 * unconditionally ("lowest priority in any geography"), the remainder is
 * sorted by total score descending, and SALESFORCE_BIG_CALENDAR_FIELD only
 * breaks a tie — it's never folded into the numeric score itself.
 */
function rankSuggestions<T extends { contact: ContactSearchResult; score: ScoreBreakdown }>(items: T[]): T[] {
  const edwardJones = items.filter((i) => i.score.flags.edwardJones);
  const rest = items.filter((i) => !i.score.flags.edwardJones);

  const byScoreThenBigCalendar = (a: T, b: T) => {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    const aBig = Boolean(a.contact.bigCalendarValue);
    const bBig = Boolean(b.contact.bigCalendarValue);
    if (aBig !== bBig) return aBig ? -1 : 1;
    return 0;
  };

  return [...rest.sort(byScoreThenBigCalendar), ...edwardJones.sort(byScoreThenBigCalendar)];
}

export type SuggestionDiagnostics = {
  /** Contacts found within the search radius with a geocoded parent Account. */
  candidatesFound: number;
  /** Of those, how many have at least one qualifying meeting on record (the rest are treated as "never met" and dropped). */
  withMeetingHistory: number;
  /** Of those, how many passed the recency/tier/priority-list filters (before dedupe/ranking). */
  passedFilters: number;
};

export async function findSuggestedFAs(
  accessToken: string,
  instanceUrl: string,
  args: {
    wholesalerId: string;
    centerLat: number;
    centerLng: number;
    existingStops: LoopStop[];
    date: string;
    filters: SuggestionFilters;
  }
): Promise<{ suggestions: FaSuggestion[]; configFlags: SuggestionConfigFlags; diagnostics: SuggestionDiagnostics }> {
  const configFlags = getSuggestionConfigFlags();

  const excludeAccountIds = args.existingStops
    .map((s) => s.accountId)
    .filter((id): id is string => Boolean(id));

  const candidates = await findContactsNearLocation(
    accessToken,
    instanceUrl,
    { lat: args.centerLat, lng: args.centerLng },
    { radiusMiles: args.filters.radiusMiles, excludeAccountIds, limit: 300 }
  );

  if (candidates.length === 0) {
    return {
      suggestions: [],
      configFlags,
      diagnostics: { candidatesFound: 0, withMeetingHistory: 0, passedFilters: 0 },
    };
  }

  const contactIds = candidates.map((c) => c.id);
  const today = todayIso();

  const [activityMap, futureBooked, aumMap] = await Promise.all([
    fetchMeetingActivity(accessToken, instanceUrl, contactIds),
    fetchFutureBooked(accessToken, instanceUrl, contactIds),
    fetchAumSignals(accessToken, instanceUrl, Array.from(new Set(candidates.map((c) => c.accountId)))),
  ]);

  const scored: {
    contact: ContactSearchResult;
    score: ScoreBreakdown;
    daysSinceLastMeeting: number;
    meetingCount: number;
  }[] = [];

  let withMeetingHistory = 0;

  for (const contact of candidates) {
    const rows = activityMap.get(contact.id) ?? [];
    const summary = summarizeActivity(rows, today);
    if (summary.daysSinceLastMeeting !== null) withMeetingHistory++;
    const score = scoreContact(
      contact,
      { ...summary, hasFutureBookedMeeting: futureBooked.has(contact.id) },
      args.filters,
      aumMap.get(contact.accountId)
    );
    if (!score || summary.daysSinceLastMeeting === null) continue;
    scored.push({ contact, score, daysSinceLastMeeting: summary.daysSinceLastMeeting, meetingCount: summary.meetingCount });
  }

  const ranked = rankSuggestions(dedupeByAccount(scored)).slice(0, MAX_SUGGESTIONS);

  const placed: FaSuggestion[] = ranked.map(({ contact, score, daysSinceLastMeeting, meetingCount }) => {
    // Guaranteed non-null by findContactsNearLocation's WHERE clause.
    const candidateStop: Omit<LoopStop, "id"> = {
      wholesalerId: args.wholesalerId,
      accountId: contact.accountId,
      firmName: `${contact.name} — ${contact.accountName}`,
      address: contact.address,
      lat: contact.lat as number,
      lng: contact.lng as number,
      meetingDate: args.date,
      meetingTime: null,
      durationMinutes: DEFAULT_SUGGESTION_DURATION_MINUTES,
      lastActivityDate: contact.lastActivityDate,
      locationAum: contact.locationAum,
    };
    const { suggestedTime, verdict } = placeCandidate(args.existingStops, candidateStop, args.date);

    return {
      contact,
      daysSinceLastMeeting,
      meetingCount,
      score,
      suggestedTime,
      durationMinutes: DEFAULT_SUGGESTION_DURATION_MINUTES,
      verdict,
    };
  });

  // Every candidate stays suggested even when placeCandidate's retry search
  // couldn't find a fully clean slot — it still returns the best time it
  // found, and the verdict pill (ok/tight/conflict) tells the internal
  // wholesaler honestly how good that time actually is, the same way the
  // manual candidate-firm flow shows a conflict and still lets them decide.
  const suggestions = placed;

  return {
    suggestions,
    configFlags,
    diagnostics: {
      candidatesFound: candidates.length,
      withMeetingHistory,
      passedFilters: scored.length,
    },
  };
}
