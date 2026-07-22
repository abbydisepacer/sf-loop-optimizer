import { MOCK_ACCOUNTS } from "./mock-accounts";
import { placeCandidate } from "./candidate-placement";
import { estimateDrive } from "./routing-engine";
import type { LoopStop } from "./types";
import {
  getSuggestionConfigFlags,
  DEFAULT_SUGGESTION_DURATION_MINUTES,
  type SuggestionFilters,
  type FaSuggestion,
  type SuggestionConfigFlags,
  type SuggestionDiagnostics,
} from "./salesforce/fa-suggestions";

/**
 * Stands in for the real Salesforce Contact search + activity-history
 * scoring when Salesforce isn't configured yet — mirrors mock-accounts.ts's
 * role for the manual candidate-firm flow. daysSinceLastMeeting/meetingCount
 * are fabricated directly rather than derived, since there's no mock
 * Task/Event history to compute them from.
 */
const MOCK_FA_CONTACTS = [
  { name: "Karen Whitfield", title: "Managing Partner", phone: "610-555-0142", account: MOCK_ACCOUNTS[0], daysSinceLastMeeting: 82, meetingCount: 6 },
  { name: "Derek Sanborn", title: "Financial Advisor", phone: "610-555-0198", account: MOCK_ACCOUNTS[1], daysSinceLastMeeting: 210, meetingCount: 2 },
  { name: "Priya Anand", title: "Senior Advisor", phone: "610-555-0233", account: MOCK_ACCOUNTS[3], daysSinceLastMeeting: 140, meetingCount: 9 },
  { name: "Tom Reyes", title: "Advisor", phone: "610-555-0177", account: MOCK_ACCOUNTS[5], daysSinceLastMeeting: 410, meetingCount: 1 },
  { name: "Angela Moss", title: "Partner", phone: "610-555-0261", account: MOCK_ACCOUNTS[7], daysSinceLastMeeting: 95, meetingCount: 4 },
] as const;

function tierFor(days: number): "active" | "faded" | "prospect" {
  if (days < 200) return "active";
  if (days < 400) return "faded";
  return "prospect";
}

export function findMockSuggestedFAs(
  wholesalerId: string,
  existingStops: LoopStop[],
  date: string,
  filters: SuggestionFilters,
  center: { lat: number; lng: number }
): { suggestions: FaSuggestion[]; configFlags: SuggestionConfigFlags; diagnostics: SuggestionDiagnostics } {
  const configFlags = getSuggestionConfigFlags();

  // Mirrors the real path's exclusion (findContactsNearLocation's
  // `AccountId NOT IN (...)` clause) — a firm already on today's schedule
  // shouldn't show back up as a suggestion to add again.
  const excludeAccountIds = new Set(
    existingStops.map((s) => s.accountId).filter((id): id is string => Boolean(id))
  );

  // Mirrors the real path's radius filter (findContactsNearLocation) — a mock
  // contact hundreds of miles from today's loop shouldn't show up as a
  // "suggestion" any more than a real Contact outside the SOQL DISTANCE
  // filter would.
  const candidatesFound = MOCK_FA_CONTACTS.filter(
    (c) =>
      !excludeAccountIds.has(c.account.id) &&
      c.account.lat !== null &&
      c.account.lng !== null &&
      estimateDrive(center, { lat: c.account.lat, lng: c.account.lng }).miles <= filters.radiusMiles
  );
  // Every mock contact has a fabricated daysSinceLastMeeting — there's no "never met" case to simulate here.
  const withMeetingHistory = candidatesFound.length;

  const passedFilters = candidatesFound
    .filter((c) => c.daysSinceLastMeeting >= filters.minDaysSinceLastMeeting)
    .filter((c) => {
      const tier = tierFor(c.daysSinceLastMeeting);
      if (tier === "faded" && !filters.includeFaded) return false;
      if (tier === "prospect" && !filters.includeProspect) return false;
      return true;
    })
    .filter((c) => {
      if (filters.minLocationAum > 0 && (c.account.locationAum === null || c.account.locationAum < filters.minLocationAum)) {
        return false;
      }
      return true;
    });

  const placed = passedFilters
    .map((c) => {
      const tier = tierFor(c.daysSinceLastMeeting);
      const base = tier === "active" ? 100 : tier === "faded" ? 40 : 10;
      const meetingBoost = Math.min(30, c.meetingCount * 3);
      const accountNameLower = c.account.name.toLowerCase();

      const candidateStop: Omit<LoopStop, "id"> = {
        wholesalerId,
        accountId: c.account.id,
        firmName: `${c.name} — ${c.account.name}`,
        address: c.account.address,
        lat: c.account.lat as number,
        lng: c.account.lng as number,
        meetingDate: date,
        meetingTime: null,
        durationMinutes: DEFAULT_SUGGESTION_DURATION_MINUTES,
        lastActivityDate: c.account.lastActivityDate,
        locationAum: c.account.locationAum,
      };
      const { suggestedTime, verdict } = placeCandidate(existingStops, candidateStop, date);

      return {
        contact: {
          id: `mock-contact-${c.account.id}`,
          name: c.name,
          title: c.title,
          phone: c.phone,
          mobilePhone: null,
          accountId: c.account.id,
          accountName: c.account.name,
          address: c.account.address,
          lat: c.account.lat,
          lng: c.account.lng,
          lastActivityDate: c.account.lastActivityDate,
          locationAum: c.account.locationAum,
          cadenceDays: null,
          priorityListValue: null,
          shareAdjustmentValue: null,
          bigCalendarValue: null,
        },
        daysSinceLastMeeting: c.daysSinceLastMeeting,
        meetingCount: c.meetingCount,
        score: {
          tier,
          base,
          boosts: meetingBoost > 0 ? [{ label: "Meeting history", amount: meetingBoost }] : [],
          total: base + meetingBoost,
          flags: {
            edwardJones: accountNameLower.includes("edward jones"),
            ameripriseCallOnly: accountNameLower.includes("ameriprise"),
            shareCountRedFlag: false,
          },
        },
        suggestedTime,
        durationMinutes: DEFAULT_SUGGESTION_DURATION_MINUTES,
        verdict,
      };
    })
    .sort((a, b) => b.score.total - a.score.total);

  return {
    suggestions: placed,
    configFlags,
    diagnostics: {
      candidatesFound: candidatesFound.length,
      withMeetingHistory,
      passedFilters: passedFilters.length,
    },
  };
}
