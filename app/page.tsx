import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/session";
import { fetchAllExternalWholesalers } from "@/lib/salesforce/auth";
import LoopView from "@/components/LoopView";
import CheckFitTool from "@/components/internal/CheckFitTool";
import AdminViewSwitcher from "@/components/admin/AdminViewSwitcher";

export default async function Home() {
  const cookieStore = await cookies();
  const session = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!session) {
    redirect("/login");
  }

  if (session.role === "admin") {
    // Fetched fresh here rather than trusted from the session cookie — see
    // the comment in the OAuth callback for why it's not persisted there.
    let currentUser = session;
    if (session.salesforceAccessToken && session.salesforceInstanceUrl) {
      try {
        const assignedExternals = await fetchAllExternalWholesalers({
          access_token: session.salesforceAccessToken,
          instance_url: session.salesforceInstanceUrl,
        });
        currentUser = { ...session, assignedExternals };
      } catch (err) {
        console.error("Failed to fetch external wholesalers for admin view:", err);
        currentUser = { ...session, assignedExternals: [] };
      }
    }
    return <AdminViewSwitcher currentUser={currentUser} />;
  }

  if (session.role === "internal") {
    return <CheckFitTool currentUser={session} />;
  }

  return <LoopView currentUser={session} />;
}
