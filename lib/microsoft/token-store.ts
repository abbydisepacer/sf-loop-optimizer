import fs from "fs";
import path from "path";

/**
 * Microsoft's access/refresh tokens are too large for a cookie — even split
 * into their own cookie (the first fix tried here), a refresh token alone
 * can run several thousand characters, and combined with the access token
 * and JSON/base64url overhead it still blew past the browser's ~4KB
 * per-cookie limit, which fails completely silently. Held server-side
 * instead, keyed by the session's Salesforce userId.
 *
 * Persisted to a local JSON file rather than a database — this app doesn't
 * have one, and deploys to a single always-on EC2 instance, so a file on
 * its disk survives restarts/redeploys just as well a database would for
 * this purpose, without the added infrastructure. Would need a real shared
 * store (DB/Redis) if this ever runs on more than one instance at once.
 *
 * Reads/writes are synchronous on purpose: Node's synchronous fs calls
 * block the event loop for their duration, which — since JS in a single
 * Node process never runs two callbacks at once — makes each
 * read-modify-write here atomic with respect to concurrent requests. This
 * app's request volume is far too low for that blocking cost to matter.
 */

export type MicrosoftTokenData = {
  microsoftAccessToken: string;
  microsoftRefreshToken: string;
  /** Epoch ms. */
  microsoftTokenExpiresAt: number;
};

const STORE_FILE = path.join(process.cwd(), ".data", "ms-tokens.json");

function readAll(): Record<string, MicrosoftTokenData> {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, MicrosoftTokenData>): void {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(data), "utf-8");
}

export function setMicrosoftTokens(userId: string, data: MicrosoftTokenData): void {
  const all = readAll();
  all[userId] = data;
  writeAll(all);
}

export function getMicrosoftTokens(userId: string): MicrosoftTokenData | null {
  return readAll()[userId] ?? null;
}

export function clearMicrosoftTokens(userId: string): void {
  const all = readAll();
  delete all[userId];
  writeAll(all);
}
