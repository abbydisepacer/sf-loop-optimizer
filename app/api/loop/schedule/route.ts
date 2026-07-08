import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";
import { scheduleVisit, type ScheduleVisitInput } from "@/lib/salesforce/loop-write";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/microsoft/calendar";
import { getValidMicrosoftToken, type ValidMicrosoftToken } from "@/lib/microsoft/auth";
import { getMicrosoftTokens, setMicrosoftTokens } from "@/lib/microsoft/token-store";
import type { Session } from "@/lib/session";

async function resolveToken(session: Session): Promise<ValidMicrosoftToken | null> {
  const tokenData = getMicrosoftTokens(session.userId);
  const tokenResult = await getValidMicrosoftToken(tokenData, session.role).catch((err) => {
    console.error("Failed to refresh Microsoft token:", err);
    return null;
  });
  if (tokenResult?.refreshed) {
    setMicrosoftTokens(session.userId, {
      microsoftAccessToken: tokenResult.refreshed.accessToken,
      microsoftRefreshToken: tokenResult.refreshed.refreshToken,
      microsoftTokenExpiresAt: tokenResult.refreshed.expiresAt,
    });
  }
  return tokenResult;
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session || (session.role !== "internal" && session.role !== "admin")) {
    return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });
  }

  const body: ScheduleVisitInput = await request.json();
  if (
    !body.wholesalerId ||
    !body.wholesalerEmail ||
    !body.timeZone ||
    !body.firmName ||
    !body.meetingDate ||
    !body.meetingTime
  ) {
    return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  // Falls back to the mocked write only in dev/mock-login sessions, where
  // there's no real Microsoft connection at all.
  const tokenResult = await resolveToken(session);

  if (tokenResult) {
    try {
      const result = await createCalendarEvent(tokenResult.accessToken, body.wholesalerEmail, body, body.timeZone);
      return NextResponse.json(result);
    } catch (err) {
      console.error("Failed to create Outlook event:", err);
      return NextResponse.json({ success: false, error: "Outlook write failed — try again." }, { status: 502 });
    }
  }

  const result = await scheduleVisit(body);
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies();
  const session = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session || (session.role !== "internal" && session.role !== "admin")) {
    return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });
  }

  const body: { wholesalerEmail?: string; eventId?: string } = await request.json();
  if (!body.wholesalerEmail || !body.eventId) {
    return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  const tokenResult = await resolveToken(session);
  // No connection to delete anything from — this can only be a mocked
  // stop (never actually written to Outlook), so there's nothing to do.
  if (!tokenResult) {
    return NextResponse.json({ success: true });
  }

  try {
    const result = await deleteCalendarEvent(tokenResult.accessToken, body.wholesalerEmail, body.eventId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to delete Outlook event:", err);
    return NextResponse.json({ success: false, error: "Outlook write failed — try again." }, { status: 502 });
  }
}
