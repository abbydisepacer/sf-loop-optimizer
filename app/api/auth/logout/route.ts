import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";
import { clearMicrosoftTokens } from "@/lib/microsoft/token-store";

export async function GET(request: NextRequest) {
  const session = verifySession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (session) {
    clearMicrosoftTokens(session.userId);
  }

  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
