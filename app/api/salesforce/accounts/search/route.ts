import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";
import { searchAccounts } from "@/lib/salesforce/accounts";
import { searchMockAccounts } from "@/lib/mock-accounts";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ accounts: [] });
  }

  const session = verifySession((await cookies()).get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!session.salesforceAccessToken || !session.salesforceInstanceUrl) {
    return NextResponse.json({ accounts: searchMockAccounts(query) });
  }

  try {
    const accounts = await searchAccounts(session.salesforceAccessToken, session.salesforceInstanceUrl, query);
    return NextResponse.json({ accounts });
  } catch (err) {
    console.error("Account search failed:", err);
    return NextResponse.json(
      { error: "Salesforce search failed — try logging in again." },
      { status: 502 }
    );
  }
}
