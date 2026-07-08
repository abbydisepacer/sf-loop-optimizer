import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeMicrosoftCodeForToken,
  MS_OAUTH_STATE_COOKIE_NAME,
  MS_OAUTH_VERIFIER_COOKIE_NAME,
} from "@/lib/microsoft/auth";
import { setMicrosoftTokens } from "@/lib/microsoft/token-store";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = cookieStore.get(MS_OAUTH_STATE_COOKIE_NAME)?.value;
  const codeVerifier = cookieStore.get(MS_OAUTH_VERIFIER_COOKIE_NAME)?.value;

  if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
    return NextResponse.redirect(new URL("/?error=outlook_invalid_state", request.url));
  }

  try {
    const token = await exchangeMicrosoftCodeForToken(code, codeVerifier, session.role);

    // Held server-side, not in a cookie — Graph's access + refresh tokens
    // are large enough on their own to exceed the browser's ~4KB per-cookie
    // limit, which fails completely silently. See lib/microsoft/token-store.ts.
    setMicrosoftTokens(session.userId, {
      microsoftAccessToken: token.access_token,
      microsoftRefreshToken: token.refresh_token,
      microsoftTokenExpiresAt: Date.now() + token.expires_in * 1000,
    });

    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.delete(MS_OAUTH_STATE_COOKIE_NAME);
    response.cookies.delete(MS_OAUTH_VERIFIER_COOKIE_NAME);
    return response;
  } catch (err) {
    console.error("Microsoft OAuth callback failed:", err);
    return NextResponse.redirect(new URL("/?error=outlook_connect_failed", request.url));
  }
}
