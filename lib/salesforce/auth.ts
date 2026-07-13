export const SALESFORCE_API_VERSION = "v61.0";

export const OAUTH_STATE_COOKIE_NAME = "sf_oauth_state";
export const OAUTH_VERIFIER_COOKIE_NAME = "sf_oauth_verifier";

function loginUrl(): string {
  return process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com";
}

/**
 * True once a real Connected App is configured. Until then, the app falls
 * back to a mock login screen so the role-based view logic can be built
 * and reviewed without a live Salesforce org.
 */
export function isSalesforceConfigured(): boolean {
  return Boolean(
    process.env.SALESFORCE_CLIENT_ID &&
      process.env.SALESFORCE_CLIENT_SECRET &&
      process.env.SALESFORCE_REDIRECT_URI
  );
}

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.SALESFORCE_CLIENT_ID!,
    redirect_uri: process.env.SALESFORCE_REDIRECT_URI!,
    // "api" for the UserRole query, "openid" to call the identity URL for
    // the user's id/name. Matches the two scopes selectable in the
    // External Client App's OAuth settings — no separate "id" scope needed.
    scope: "api openid",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    // Forces the login page every time instead of silently reusing an
    // already-active Salesforce session in the browser — our own logout
    // doesn't touch Salesforce's session, so without this, "Sign in with
    // Salesforce" after logging out could re-enter as the same user with
    // no way to switch accounts. Salesforce only supports "login"/"consent"
    // here — no "select_account" like Google/Microsoft.
    prompt: "login",
  });
  return `${loginUrl()}/services/oauth2/authorize?${params}`;
}

export type TokenResponse = {
  access_token: string;
  instance_url: string;
  /** The identity URL — call this (with the access token) for basic user info. */
  id: string;
};

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<TokenResponse> {
  const res = await fetch(`${loginUrl()}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.SALESFORCE_CLIENT_ID!,
      client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
      redirect_uri: process.env.SALESFORCE_REDIRECT_URI!,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Salesforce token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export type SalesforceUserProfile = {
  userId: string;
  name: string;
  /** Assumed to match this user's Microsoft 365 UPN — see lib/microsoft/calendar.ts. */
  email: string;
  /** The user's Role Hierarchy role name — e.g. "Internal Wholesaler". Null if unassigned. */
  roleName: string | null;
};

/**
 * Fetches the user's identity, then a SOQL query for their Role Hierarchy
 * role name (UserRole.Name is not part of the standard identity/userinfo
 * payload, so it needs a separate REST API query).
 */
export async function fetchUserProfile(token: TokenResponse): Promise<SalesforceUserProfile> {
  const identityRes = await fetch(token.id, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!identityRes.ok) {
    throw new Error(`Salesforce identity lookup failed (${identityRes.status})`);
  }
  const identity = await identityRes.json();

  const soql = `SELECT UserRole.Name FROM User WHERE Id = '${identity.user_id}'`;
  const queryRes = await fetch(
    `${token.instance_url}/services/data/${SALESFORCE_API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${token.access_token}` } }
  );
  if (!queryRes.ok) {
    throw new Error(`Salesforce role lookup failed (${queryRes.status})`);
  }
  const result = await queryRes.json();
  const roleName: string | null = result.records?.[0]?.UserRole?.Name ?? null;

  return {
    userId: identity.user_id,
    name: identity.display_name,
    email: identity.email,
    roleName,
  };
}

/** email is assumed to match the wholesaler's Microsoft 365 UPN — see lib/microsoft/calendar.ts. */
export type AssignedExternal = { id: string; name: string; email: string };

/**
 * Externals assigned to a given Internal Wholesaler, via the Lookup field
 * on the External Wholesaler's own User record that names their assigned
 * Internal Wholesaler. The field's API name wasn't guessed — set
 * SALESFORCE_INTERNAL_WHOLESALER_FIELD once you've confirmed it in Object
 * Manager (e.g. "Internal_Wholesaler__c").
 */
export async function fetchAssignedExternalWholesalers(
  token: TokenResponse,
  internalUserId: string
): Promise<AssignedExternal[]> {
  const field = process.env.SALESFORCE_INTERNAL_WHOLESALER_FIELD;
  if (!field) {
    console.warn(
      "SALESFORCE_INTERNAL_WHOLESALER_FIELD is not set — internal wholesalers will see no assigned externals until it's configured."
    );
    return [];
  }

  const soql = `SELECT Id, Name, Email FROM User WHERE UserRole.Name = 'External Wholesaler' AND IsActive = true AND ${field} = '${internalUserId}' ORDER BY FirstName`;
  const res = await fetch(
    `${token.instance_url}/services/data/${SALESFORCE_API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${token.access_token}` } }
  );
  if (!res.ok) {
    throw new Error(`Salesforce assigned-externals lookup failed (${res.status})`);
  }
  const result = await res.json();
  const records: { Id: string; Name: string; Email: string }[] = result.records ?? [];
  return records.map((r) => ({ id: r.Id, name: r.Name, email: r.Email }));
}

/**
 * Maps a Salesforce Role Hierarchy role name to the app's internal role.
 * Exact match (case-insensitive) against the org's three confirmed role
 * names — not a substring match, so an unrelated role that happens to
 * contain "internal"/"external" (e.g. "Internal Support") can't be
 * misclassified as a wholesaler role.
 */
export function mapRoleName(roleName: string | null): "internal" | "external" | "admin" | null {
  if (!roleName) return null;
  const normalized = roleName.trim().toLowerCase();
  if (normalized === "internal wholesaler") return "internal";
  if (normalized === "external wholesaler") return "external";
  if (normalized === "view all") return "admin";
  return null;
}

/**
 * Every active External Wholesaler in the org, for the "View All" admin
 * role — unlike fetchAssignedExternalWholesalers, this isn't scoped to one
 * Internal Wholesaler's team. Deliberately re-fetched per page load rather
 * than cached in the session cookie: an org-wide list can be large enough
 * to push the signed cookie past the browser's ~4KB per-cookie limit, which
 * fails silently (login appears to succeed, then the session is gone).
 */
export async function fetchAllExternalWholesalers(token: {
  access_token: string;
  instance_url: string;
}): Promise<AssignedExternal[]> {
  const soql = `SELECT Id, Name, Email FROM User WHERE UserRole.Name = 'External Wholesaler' AND IsActive = true ORDER BY FirstName`;
  const res = await fetch(
    `${token.instance_url}/services/data/${SALESFORCE_API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${token.access_token}` } }
  );
  if (!res.ok) {
    throw new Error(`Salesforce all-externals lookup failed (${res.status})`);
  }
  const result = await res.json();
  const records: { Id: string; Name: string; Email: string }[] = result.records ?? [];
  return records.map((r) => ({ id: r.Id, name: r.Name, email: r.Email }));
}
