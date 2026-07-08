export type ScheduleVisitInput = {
  wholesalerId: string;
  accountId: string | null;
  firmName: string;
  address: { street: string; city: string; state: string; zip: string };
  meetingDate: string;
  meetingTime: string;
  durationMinutes: number;
};

export type ScheduleVisitResult =
  | { success: true; recordId: string; mocked: boolean }
  | { success: false; error: string };

/**
 * Mock fallback used when there's no real Salesforce session (dev/mock
 * login) or SALESFORCE_EVENT_TIMEZONE isn't configured yet — see
 * lib/salesforce/events.ts for the real write. Simulates success so the
 * Add-to-Schedule flow can be reviewed end-to-end either way. `mocked: true`
 * lets the UI say honestly that this wasn't actually saved.
 */
export async function scheduleVisit(input: ScheduleVisitInput): Promise<ScheduleVisitResult> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log("[MOCK] Would create a Salesforce visit record:", input);
  return { success: true, recordId: `MOCK-${Math.random().toString(36).slice(2, 10)}`, mocked: true };
}
