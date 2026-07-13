import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { OAUTH_STATE_COOKIE_NAME, OAUTH_VERIFIER_COOKIE_NAME } from "@/lib/salesforce/auth";
import { MS_OAUTH_STATE_COOKIE_NAME, MS_OAUTH_VERIFIER_COOKIE_NAME } from "@/lib/microsoft/auth";
import { getRequestOrigin } from "@/lib/request-origin";

// Deliberately doesn't touch the Microsoft/Outlook connection — that's
// stored separately, keyed by userId (see lib/microsoft/token-store.ts),
// specifically so signing out of Salesforce (or a forced prompt=login
// re-auth) doesn't force reconnecting Outlook too. It's "once and done"
// until the connection itself is revoked (e.g. in Microsoft's admin
// console) or the refresh token expires from long inactivity.
//
// The PKCE state/verifier cookies below are normally short-lived and
// deleted right after their own OAuth callback completes, but are cleared
// here too in case a login attempt was ever started and abandoned
// mid-flow — logout should leave no cookie behind that isn't the
// long-lived Microsoft connection.
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", getRequestOrigin(request)));
  response.cookies.delete(SESSION_COOKIE_NAME);
  response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
  response.cookies.delete(OAUTH_VERIFIER_COOKIE_NAME);
  response.cookies.delete(MS_OAUTH_STATE_COOKIE_NAME);
  response.cookies.delete(MS_OAUTH_VERIFIER_COOKIE_NAME);
  return response;
}
