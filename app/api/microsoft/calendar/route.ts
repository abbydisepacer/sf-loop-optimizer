import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getValidMicrosoftToken } from "@/lib/microsoft/auth";
import { getMicrosoftTokens, setMicrosoftTokens } from "@/lib/microsoft/token-store";
import { getCalendarEvents } from "@/lib/microsoft/calendar";

/**
 * Reads a wholesaler's Outlook calendar for one date. An external session
 * reads their own calendar (own Microsoft connection, own email); an
 * internal/admin session reads someone else's shared calendar (their own
 * Microsoft connection, but the target wholesaler's id/email as params) —
 * either way, `connected: false` in the response means Outlook was never
 * connected for the type of access being requested, and the UI should
 * prompt to connect rather than treat an empty result as "no meetings."
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json({ stops: [], preExisting: [], connected: false });
  }

  let wholesalerId: string;
  let email: string;
  if (session.role === "external") {
    wholesalerId = session.userId;
    if (!session.email) {
      return NextResponse.json({ stops: [], preExisting: [], connected: false });
    }
    email = session.email;
  } else {
    wholesalerId = request.nextUrl.searchParams.get("wholesalerId") ?? "";
    email = request.nextUrl.searchParams.get("email") ?? "";
    if (!wholesalerId || !email) {
      return NextResponse.json({ stops: [], preExisting: [], connected: false });
    }
  }

  const tokenData = getMicrosoftTokens(session.userId);
  const tokenResult = await getValidMicrosoftToken(tokenData, session.role).catch((err) => {
    console.error("Failed to refresh Microsoft token:", err);
    return null;
  });
  if (!tokenResult) {
    return NextResponse.json({ stops: [], preExisting: [], connected: false });
  }

  try {
    // Reading your OWN calendar (external) sends your own browser's
    // timezone — that token is scoped to Calendars.Read only, with no
    // MailboxSettings.Read to look it up via Graph. Reading someone ELSE's
    // shared calendar (internal/admin) can't be looked up via Graph either
    // — MailboxSettings.Read has no ".Shared" variant, so it 403s for any
    // mailbox but your own — so the internal wholesaler picks it manually
    // in the UI instead (see CheckFitTool's timezone selector).
    const timeZone = request.nextUrl.searchParams.get("timeZone") || "UTC";
    const { stops, preExisting } = await getCalendarEvents(
      tokenResult.accessToken,
      email,
      wholesalerId,
      `${date}T00:00:00`,
      `${date}T23:59:59`,
      timeZone
    );

    if (tokenResult.refreshed) {
      setMicrosoftTokens(session.userId, {
        microsoftAccessToken: tokenResult.refreshed.accessToken,
        microsoftRefreshToken: tokenResult.refreshed.refreshToken,
        microsoftTokenExpiresAt: tokenResult.refreshed.expiresAt,
      });
    }
    return NextResponse.json({ stops, preExisting, connected: true });
  } catch (err) {
    console.error("Failed to read Outlook calendar:", err);
    return NextResponse.json(
      { stops: [], preExisting: [], connected: true, error: "Couldn't read the calendar — try again." },
      { status: 502 }
    );
  }
}
