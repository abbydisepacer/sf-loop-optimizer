import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getValidMicrosoftToken, isMicrosoftConfigured } from "@/lib/microsoft/auth";
import { getMicrosoftTokens, setMicrosoftTokens } from "@/lib/microsoft/token-store";
import { getCalendarEvents } from "@/lib/microsoft/calendar";
import { fetchAccountDetailsByIds, findAccountsNearAddress } from "@/lib/salesforce/accounts";
import { getStopsForDate } from "@/lib/mock-data";

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

  // Azure AD app registration isn't configured yet (dev/mock-login mode) —
  // "Connect Outlook" isn't offered anywhere in this mode, so treat the
  // wholesaler as reachable with an empty starting schedule instead of
  // showing the "Connect Outlook" wall, matching the same graceful
  // degradation the mock Salesforce login already gets.
  if (!isMicrosoftConfigured()) {
    return NextResponse.json({ stops: getStopsForDate(wholesalerId, date), preExisting: [], connected: true });
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

    // Last Activity Date / Location AUM can change after a visit was
    // originally scheduled, so they're re-fetched fresh on every read
    // rather than trusted from whatever was frozen in the Outlook event at
    // creation time. Only possible with a real Salesforce session — skipped
    // silently in mock-login/dev mode.
    if (session.salesforceAccessToken && session.salesforceInstanceUrl) {
      const accessToken = session.salesforceAccessToken;
      const instanceUrl = session.salesforceInstanceUrl;

      const accountIds = [...new Set(stops.map((s) => s.accountId).filter((id): id is string => Boolean(id)))];
      if (accountIds.length > 0) {
        try {
          const details = await fetchAccountDetailsByIds(accessToken, instanceUrl, accountIds);
          for (const stop of stops) {
            const d = stop.accountId ? details.get(stop.accountId) : undefined;
            if (d) {
              stop.lastActivityDate = d.lastActivityDate;
              stop.locationAum = d.locationAum;
            }
          }
        } catch (err) {
          console.error("Failed to enrich stops with Account details:", err);
        }
      }

      // Fallback for a visit scheduled before this app started embedding
      // accountId in the Outlook event — its marker payload predates that
      // field, so there's nothing to look up by Id. Matches on the stop's
      // own address instead, the same proximity lookup used when picking a
      // new candidate's address (see CheckFitTool's handlePlaceSelected).
      const staleStops = stops.filter((s) => !s.accountId && !s.fromCalendarEvent);
      for (const stop of staleStops) {
        try {
          const [match] = await findAccountsNearAddress(accessToken, instanceUrl, {
            lat: stop.lat,
            lng: stop.lng,
            streetFragment: stop.address.street,
          });
          if (match) {
            stop.accountId = match.id;
            stop.lastActivityDate = match.lastActivityDate;
            stop.locationAum = match.locationAum;
          }
        } catch (err) {
          console.error("Failed to match stale stop to an Account by address:", err);
        }
      }
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
