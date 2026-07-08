import { signCookie, verifyCookie } from "./signed-cookie";

export const SESSION_COOKIE_NAME = "sf_loop_session";

/** email is the wholesaler's Microsoft 365 UPN, assumed to match their Salesforce login email. */
export type AssignedExternal = { id: string; name: string; email: string };

export type Session = {
  /** Salesforce User Id (or a mock id, when Salesforce isn't configured yet). */
  userId: string;
  name: string;
  /**
   * This user's own email — assumed to match their Microsoft 365 UPN.
   * Used by the "external" role to read/write their own Outlook calendar;
   * internal/admin sessions use assignedExternals' emails instead, to act
   * on someone else's shared calendar.
   */
  email?: string;
  role: "internal" | "external" | "admin";
  /**
   * For internal role sessions: the external wholesalers assigned to this
   * person. For admin ("View All") sessions: every external wholesaler in
   * the org, so they can preview any of their schedules.
   */
  assignedExternals?: AssignedExternal[];
  /**
   * Present only for real Salesforce logins — lets internal-role features
   * (like Account search) call the Salesforce REST API for the rest of the
   * session, not just at login. Expires with the org's session timeout;
   * there's no refresh-token flow yet, so a long-lived app session may
   * eventually need a fresh login for these calls to keep working.
   */
  salesforceAccessToken?: string;
  salesforceInstanceUrl?: string;
  // Note: Microsoft tokens are deliberately NOT stored here, or in any
  // cookie — see lib/microsoft/token-store.ts. Graph access/refresh tokens
  // are large enough on their own to exceed the browser's ~4KB per-cookie
  // limit, which fails completely silently (the Set-Cookie looked fine,
  // but the browser just declined to store it) — the exact same failure
  // mode hit earlier with admin's org-wide assignedExternals list.
};

export function signSession(session: Session): string {
  return signCookie(session);
}

export function verifySession(cookieValue: string | undefined): Session | null {
  const parsed = verifyCookie<Session>(cookieValue);
  if (
    parsed?.userId &&
    parsed?.name &&
    (parsed.role === "internal" || parsed.role === "external" || parsed.role === "admin")
  ) {
    return parsed;
  }
  return null;
}
