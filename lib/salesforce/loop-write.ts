export type ScheduleVisitInput = {
  wholesalerId: string;
  /** The wholesaler's Outlook UPN — see lib/microsoft/calendar.ts. */
  wholesalerEmail: string;
  /**
   * IANA zone name, chosen by the internal wholesaler in the UI — Graph has
   * no reliable way to look up a DIFFERENT mailbox's timezone (Microsoft's
   * MailboxSettings.Read is delegated-only for your own mailbox, with no
   * ".Shared" variant), so this can't be resolved automatically for someone
   * else's calendar.
   */
  timeZone: string;
  accountId: string | null;
  firmName: string;
  address: { street: string; city: string; state: string; zip: string };
  lat: number;
  lng: number;
  meetingDate: string;
  meetingTime: string;
  durationMinutes: number;
};

export type ScheduleVisitResult =
  | { success: true; recordId: string; mocked: boolean }
  | { success: false; error: string };

/**
 * Mock fallback used when there's no real Microsoft connection (dev/mock
 * login) — see lib/microsoft/calendar.ts for the real write. Simulates
 * success so the Add-to-Schedule flow can be reviewed end-to-end either way.
 * `mocked: true` lets the UI say honestly that this wasn't actually saved.
 */
export async function scheduleVisit(input: ScheduleVisitInput): Promise<ScheduleVisitResult> {
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log("[MOCK] Would create an Outlook calendar event:", input);
  return { success: true, recordId: `MOCK-${Math.random().toString(36).slice(2, 10)}`, mocked: true };
}
