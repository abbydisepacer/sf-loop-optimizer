import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  isMicrosoftConfigured,
  buildMicrosoftAuthorizeUrl,
  MS_OAUTH_STATE_COOKIE_NAME,
  MS_OAUTH_VERIFIER_COOKIE_NAME,
} from "@/lib/microsoft/auth";
import { generatePkcePair } from "@/lib/pkce";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getRequestOrigin } from "@/lib/request-origin";

/**
 * Unlike /api/auth/login (which establishes identity), this connects an
 * *additional* account onto an already-signed-in session — so it requires
 * one to exist first, rather than starting a fresh login. Internal/admin
 * connect to read/write an external's shared calendar; external connects
 * to expose their own calendar as their "loop" (their own Calendars.Read
 * access, no delegation needed for that half).
 */
export async function GET(request: NextRequest) {
  const session = verifySession((await cookies()).get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (!isMicrosoftConfigured()) {
    return NextResponse.redirect(new URL("/", getRequestOrigin(request)));
  }

  const state = randomBytes(16).toString("hex");
  const { codeVerifier, codeChallenge } = generatePkcePair();

  const response = NextResponse.redirect(buildMicrosoftAuthorizeUrl(state, codeChallenge, session.role));
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  response.cookies.set(MS_OAUTH_STATE_COOKIE_NAME, state, cookieOptions);
  response.cookies.set(MS_OAUTH_VERIFIER_COOKIE_NAME, codeVerifier, cookieOptions);
  return response;
}
