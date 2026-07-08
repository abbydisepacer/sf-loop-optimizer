import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";
import { scheduleVisit, type ScheduleVisitInput } from "@/lib/salesforce/loop-write";
import { createVisitEvent, isRealEventWriteConfigured } from "@/lib/salesforce/events";

export async function POST(request: NextRequest) {
  const session = verifySession((await cookies()).get(SESSION_COOKIE_NAME)?.value);
  if (!session || (session.role !== "internal" && session.role !== "admin")) {
    return NextResponse.json({ success: false, error: "Not authorized" }, { status: 403 });
  }

  const body: ScheduleVisitInput = await request.json();
  if (!body.wholesalerId || !body.firmName || !body.meetingDate || !body.meetingTime) {
    return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  // Falls back to the mocked write in dev/mock-login sessions, or if
  // SALESFORCE_EVENT_TIMEZONE hasn't been configured yet — see
  // lib/salesforce/events.ts for why that's required, not optional.
  if (session.salesforceAccessToken && session.salesforceInstanceUrl) {
    if (!isRealEventWriteConfigured()) {
      console.warn(
        "SALESFORCE_EVENT_TIMEZONE is not set — visits will be mocked instead of written to Salesforce until it's configured."
      );
    } else {
      try {
        const result = await createVisitEvent(session.salesforceAccessToken, session.salesforceInstanceUrl, body);
        return NextResponse.json(result);
      } catch (err) {
        console.error("Failed to create Salesforce Event:", err);
        return NextResponse.json(
          { success: false, error: "Salesforce write failed — try again." },
          { status: 502 }
        );
      }
    }
  }

  const result = await scheduleVisit(body);
  return NextResponse.json(result);
}
