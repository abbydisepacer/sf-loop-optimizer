import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";

// Deliberately doesn't touch the Microsoft/Outlook connection — that's
// stored separately, keyed by userId (see lib/microsoft/token-store.ts),
// specifically so signing out of Salesforce (or a forced prompt=login
// re-auth) doesn't force reconnecting Outlook too. It's "once and done"
// until the connection itself is revoked (e.g. in Microsoft's admin
// console) or the refresh token expires from long inactivity.
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
