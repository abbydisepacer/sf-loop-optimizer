import type { LoopStop, Wholesaler } from "./types";

export const MOCK_INTERNAL_WHOLESALERS = [
  { id: "mock-internal-alex", name: "Alex Rivera" },
  { id: "mock-internal-jamie", name: "Jamie Chen" },
];

export const MOCK_WHOLESALERS: Wholesaler[] = [
  { id: "jordan-lee", name: "Jordan Lee", internalWholesalerId: "mock-internal-alex" },
  { id: "casey-morgan", name: "Casey Morgan", internalWholesalerId: "mock-internal-alex" },
  { id: "sam-patel", name: "Sam Patel", internalWholesalerId: "mock-internal-jamie" },
];

/**
 * No pre-loaded loop data — this returns real Salesforce loop records once
 * that integration is wired up. Until then, both the External wholesaler's
 * view and the Internal Check-Fit tool start from an empty schedule per
 * wholesaler/date; the Internal tool builds one up from firms actually
 * added through its own form (see CheckFitTool's addedStops).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept stable for the future real implementation
export function getStopsForDate(wholesalerId: string, date: string): LoopStop[] {
  return [];
}
