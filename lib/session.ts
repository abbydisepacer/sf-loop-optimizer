import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "sf_loop_session";

export type AssignedExternal = { id: string; name: string };

export type Session = {
  /** Salesforce User Id (or a mock id, when Salesforce isn't configured yet). */
  userId: string;
  name: string;
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
};

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set — required to sign session cookies.");
  }
  return secret;
}

export function signSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySession(cookieValue: string | undefined): Session | null {
  if (!cookieValue) return null;
  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return null;

  const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const actual = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actual.length !== expectedBuf.length || !timingSafeEqual(actual, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (
      parsed?.userId &&
      parsed?.name &&
      (parsed.role === "internal" || parsed.role === "external" || parsed.role === "admin")
    ) {
      return parsed as Session;
    }
    return null;
  } catch {
    return null;
  }
}
