import { NextRequest, NextResponse } from "next/server";
import { isSalesforceConfigured } from "@/lib/salesforce/auth";
import { signSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { MOCK_WHOLESALERS, MOCK_INTERNAL_WHOLESALERS } from "@/lib/mock-data";

/**
 * Dev-only stand-in for the real Salesforce OAuth flow, used until a
 * Connected App is configured. Disabled automatically the moment
 * SALESFORCE_CLIENT_ID / SECRET / REDIRECT_URI are set, so it can't be
 * used to bypass real login once Salesforce is wired up.
 */
export async function GET(request: NextRequest) {
  if (isSalesforceConfigured()) {
    return NextResponse.json({ error: "Mock login is disabled — Salesforce is configured." }, { status: 403 });
  }

  const url = new URL(request.url);
  const role = url.searchParams.get("role");

  if (role !== "internal" && role !== "external" && role !== "admin") {
    return NextResponse.json({ error: "role must be 'internal', 'external', or 'admin'" }, { status: 400 });
  }

  const session =
    role === "external"
      ? (() => {
          const wholesalerId = url.searchParams.get("wholesaler") ?? MOCK_WHOLESALERS[0].id;
          const wholesaler = MOCK_WHOLESALERS.find((w) => w.id === wholesalerId) ?? MOCK_WHOLESALERS[0];
          return { userId: wholesaler.id, name: wholesaler.name, email: wholesaler.email, role: "external" as const };
        })()
      : role === "admin"
        ? {
            userId: "mock-admin",
            name: "Admin User",
            role: "admin" as const,
            assignedExternals: MOCK_WHOLESALERS.map((w) => ({ id: w.id, name: w.name, email: w.email })),
          }
        : (() => {
            const internalId = url.searchParams.get("internal") ?? MOCK_INTERNAL_WHOLESALERS[0].id;
            const internalUser =
              MOCK_INTERNAL_WHOLESALERS.find((i) => i.id === internalId) ?? MOCK_INTERNAL_WHOLESALERS[0];
            const assignedExternals = MOCK_WHOLESALERS.filter(
              (w) => w.internalWholesalerId === internalUser.id
            ).map((w) => ({ id: w.id, name: w.name, email: w.email }));
            return {
              userId: internalUser.id,
              name: internalUser.name,
              role: "internal" as const,
              assignedExternals,
            };
          })();

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(SESSION_COOKIE_NAME, signSession(session), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
  return response;
}
