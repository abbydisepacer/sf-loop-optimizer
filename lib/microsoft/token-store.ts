/**
 * Microsoft's access/refresh tokens are too large for a cookie — even split
 * into their own cookie (the first fix tried here), a refresh token alone
 * can run several thousand characters, and combined with the access token
 * and JSON/base64url overhead it still blew past the browser's ~4KB
 * per-cookie limit, which fails completely silently. Held server-side
 * instead, keyed by the session's Salesforce userId.
 *
 * This is an in-memory Map, not a database — it's lost on server restart
 * (an affected user just reconnects Outlook) and isn't shared across
 * multiple server instances. Fine for this app's current single-process
 * deployment; would need a real store (DB/Redis) to scale beyond that.
 */

export type MicrosoftTokenData = {
  microsoftAccessToken: string;
  microsoftRefreshToken: string;
  /** Epoch ms. */
  microsoftTokenExpiresAt: number;
};

// Pinned to globalThis, not a plain module-level variable — Next.js's dev
// server (particularly with Turbopack) can give different route handler
// files their own separately-instantiated copy of an imported module, so a
// plain `const store = new Map()` isn't reliably shared across routes even
// within the same Node process. globalThis is truly process-wide.
declare global {
  var __msTokenStore: Map<string, MicrosoftTokenData> | undefined;
}

const store = globalThis.__msTokenStore ?? (globalThis.__msTokenStore = new Map<string, MicrosoftTokenData>());

export function setMicrosoftTokens(userId: string, data: MicrosoftTokenData): void {
  store.set(userId, data);
}

export function getMicrosoftTokens(userId: string): MicrosoftTokenData | null {
  return store.get(userId) ?? null;
}

export function clearMicrosoftTokens(userId: string): void {
  store.delete(userId);
}
