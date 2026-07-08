import type { Session } from "@/lib/session";
import type { MicrosoftTokenData } from "./token-store";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export const MS_OAUTH_STATE_COOKIE_NAME = "ms_oauth_state";
export const MS_OAUTH_VERIFIER_COOKIE_NAME = "ms_oauth_verifier";

type MicrosoftRole = Session["role"];

/**
 * Least privilege per role: an external only ever reads their own
 * calendar, so Calendars.Read is enough. Internal/admin need to read AND
 * write someone else's shared calendar, which needs the broader scope.
 * Neither role needs MailboxSettings.Read — it's delegated-only for your
 * own mailbox with no ".Shared" variant, so it could never be used to look
 * up a DIFFERENT wholesaler's timezone anyway; the internal wholesaler
 * picks that manually in the UI instead. offline_access (both) is required
 * to get a refresh_token back — without it, a connection would only last
 * ~1hr.
 */
function scopeForRole(role: MicrosoftRole): string {
  if (role === "external") {
    return "openid offline_access Calendars.Read";
  }
  return "openid offline_access Calendars.ReadWrite.Shared";
}

function tenantId(): string | undefined {
  return process.env.MICROSOFT_TENANT_ID;
}

/**
 * True once the Azure AD app registration is configured. Until then,
 * "Connect Outlook" isn't offered and calendar reads/writes stay on their
 * mocked fallback — same graceful-degradation pattern as Salesforce.
 */
export function isMicrosoftConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_TENANT_ID
  );
}

export function buildMicrosoftAuthorizeUrl(state: string, codeChallenge: string, role: MicrosoftRole): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
    response_mode: "query",
    scope: scopeForRole(role),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/authorize?${params}`;
}

export type MicrosoftTokenResponse = {
  access_token: string;
  refresh_token: string;
  /** Seconds until expiry. */
  expires_in: number;
};

export async function exchangeMicrosoftCodeForToken(
  code: string,
  codeVerifier: string,
  role: MicrosoftRole
): Promise<MicrosoftTokenResponse> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI!,
      code_verifier: codeVerifier,
      scope: scopeForRole(role),
    }),
  });
  if (!res.ok) {
    throw new Error(`Microsoft token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

async function refreshMicrosoftToken(refreshToken: string, role: MicrosoftRole): Promise<MicrosoftTokenResponse> {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      scope: scopeForRole(role),
    }),
  });
  if (!res.ok) {
    throw new Error(`Microsoft token refresh failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export type ValidMicrosoftToken = {
  accessToken: string;
  /**
   * Set only when a refresh actually happened — the caller (a Route
   * Handler) must re-sign the session with these values and set the
   * updated cookie on its response, since that can't happen from here.
   */
  refreshed?: { accessToken: string; refreshToken: string; expiresAt: number };
};

/**
 * Resolves a usable Microsoft access token from the server-side token store
 * (see lib/microsoft/token-store.ts), refreshing it first if it's expired
 * or within 5 minutes of expiring. Returns null if Outlook was never
 * connected for this user.
 */
export async function getValidMicrosoftToken(
  tokenData: MicrosoftTokenData | null,
  role: MicrosoftRole
): Promise<ValidMicrosoftToken | null> {
  if (!tokenData) return null;

  if (Date.now() < tokenData.microsoftTokenExpiresAt - 5 * 60_000) {
    return { accessToken: tokenData.microsoftAccessToken };
  }

  const token = await refreshMicrosoftToken(tokenData.microsoftRefreshToken, role);
  return {
    accessToken: token.access_token,
    refreshed: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    },
  };
}
