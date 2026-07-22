import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";
import { findSuggestedFAs, type SuggestionFilters } from "@/lib/salesforce/fa-suggestions";
import { findMockSuggestedFAs } from "@/lib/mock-fa-suggestions";
import type { LoopStop } from "@/lib/types";

type SuggestionsRequestBody = {
  wholesalerId?: string;
  date?: string;
  existingStops?: LoopStop[];
  filters?: SuggestionFilters;
};

/** Anchor point for the radius search — the centroid of today's already-scheduled stops. */
function centroid(stops: LoopStop[]): { lat: number; lng: number } | null {
  if (stops.length === 0) return null;
  const lat = stops.reduce((sum, s) => sum + s.lat, 0) / stops.length;
  const lng = stops.reduce((sum, s) => sum + s.lng, 0) / stops.length;
  return { lat, lng };
}

export async function POST(request: NextRequest) {
  const session = verifySession((await cookies()).get(SESSION_COOKIE_NAME)?.value);
  if (!session || (session.role !== "internal" && session.role !== "admin")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body: SuggestionsRequestBody = await request.json();
  if (!body.wholesalerId || !body.date || !body.filters) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const existingStops = body.existingStops ?? [];
  const center = centroid(existingStops);
  if (!center) {
    return NextResponse.json(
      { error: "No scheduled stops on this date yet — add at least one to anchor the search area." },
      { status: 400 }
    );
  }

  if (!session.salesforceAccessToken || !session.salesforceInstanceUrl) {
    const result = findMockSuggestedFAs(body.wholesalerId, existingStops, body.date, body.filters, center);
    return NextResponse.json(result);
  }

  try {
    const result = await findSuggestedFAs(session.salesforceAccessToken, session.salesforceInstanceUrl, {
      wholesalerId: body.wholesalerId,
      centerLat: center.lat,
      centerLng: center.lng,
      existingStops,
      date: body.date,
      filters: body.filters,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("FA suggestion search failed:", err);
    return NextResponse.json(
      { error: "Salesforce search failed — try logging in again." },
      { status: 502 }
    );
  }
}
