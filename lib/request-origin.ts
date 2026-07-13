import type { NextRequest } from "next/server";

/**
 * The real external origin the browser is using — `request.url`'s own
 * host/protocol can't be trusted behind a reverse proxy in front of
 * `next start`. It reflects the proxy's own connection to the Node
 * process (e.g. "http://localhost:3000" for an nginx `proxy_pass
 * http://127.0.0.1:3000`), not what the browser actually requested, which
 * turns every `new URL(path, request.url)` redirect into one that sends
 * the browser to localhost instead of the real domain. Reads the actual
 * host from the `Host`/`X-Forwarded-Host` and `X-Forwarded-Proto` headers
 * a correctly configured proxy forwards instead. Falls back to
 * `request.url`'s own origin when neither is set — e.g. local dev with no
 * proxy in front, where request.url is already correct.
 */
export function getRequestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;

  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}
