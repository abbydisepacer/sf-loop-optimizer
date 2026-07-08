import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  isSalesforceConfigured,
  buildAuthorizeUrl,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_VERIFIER_COOKIE_NAME,
} from "@/lib/salesforce/auth";
import { generatePkcePair } from "@/lib/pkce";

export async function GET(request: NextRequest) {
  if (!isSalesforceConfigured()) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const state = randomBytes(16).toString("hex");
  const { codeVerifier, codeChallenge } = generatePkcePair();

  const response = NextResponse.redirect(buildAuthorizeUrl(state, codeChallenge));
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  response.cookies.set(OAUTH_STATE_COOKIE_NAME, state, cookieOptions);
  response.cookies.set(OAUTH_VERIFIER_COOKIE_NAME, codeVerifier, cookieOptions);
  return response;
}
