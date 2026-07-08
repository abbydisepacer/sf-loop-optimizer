import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";
import { findAccountsNearAddress } from "@/lib/salesforce/accounts";
import { findMockAccountsNearAddress } from "@/lib/mock-accounts";

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lng = Number(request.nextUrl.searchParams.get("lng"));
  const streetFragment = request.nextUrl.searchParams.get("street")?.trim() ?? "";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ accounts: [] });
  }

  const session = verifySession((await cookies()).get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!session.salesforceAccessToken || !session.salesforceInstanceUrl) {
    return NextResponse.json({ accounts: findMockAccountsNearAddress({ lat, lng }) });
  }

  try {
    const accounts = await findAccountsNearAddress(session.salesforceAccessToken, session.salesforceInstanceUrl, {
      lat,
      lng,
      streetFragment,
    });
    return NextResponse.json({ accounts });
  } catch (err) {
    console.error("Account search-by-address failed:", err);
    return NextResponse.json({ accounts: [] });
  }
}
