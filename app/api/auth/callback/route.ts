import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  fetchUserProfile,
  fetchAssignedExternalWholesalers,
  mapRoleName,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_VERIFIER_COOKIE_NAME,
} from "@/lib/salesforce/auth";
import { signSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value;
  const codeVerifier = request.cookies.get(OAUTH_VERIFIER_COOKIE_NAME)?.value;

  if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", request.url));
  }

  try {
    const token = await exchangeCodeForToken(code, codeVerifier);
    const profile = await fetchUserProfile(token);
    const role = mapRoleName(profile.roleName);

    if (!role) {
      const message = profile.roleName
        ? `Salesforce role "${profile.roleName}" isn't recognized as Internal Wholesaler, External Wholesaler, or View All.`
        : "This Salesforce user has no Role assigned.";
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(message)}`, request.url)
      );
    }

    // Admin's assignedExternals is deliberately NOT fetched/stored here — an
    // org-wide list risks pushing the signed session cookie past the
    // browser's per-cookie size limit. It's fetched fresh per page load
    // instead (see app/page.tsx), using the token below.
    const assignedExternals =
      role === "internal" ? await fetchAssignedExternalWholesalers(token, profile.userId) : undefined;

    // Microsoft's connection lives in a server-side store keyed by userId
    // (see lib/microsoft/token-store.ts), not the session cookie — so it's
    // untouched by a fresh Salesforce login like this one, and survives,
    // e.g., a prompt=login re-authentication with no carry-over logic needed.
    const session = signSession({
      userId: profile.userId,
      name: profile.name,
      email: profile.email,
      role,
      assignedExternals,
      salesforceAccessToken: token.access_token,
      salesforceInstanceUrl: token.instance_url,
    });
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(SESSION_COOKIE_NAME, session, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 8,
      path: "/",
    });
    response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    response.cookies.delete(OAUTH_VERIFIER_COOKIE_NAME);
    return response;
  } catch (err) {
    console.error("Salesforce OAuth callback failed:", err);
    return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
  }
}
