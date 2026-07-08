import { isSalesforceConfigured } from "@/lib/salesforce/auth";
import { MOCK_WHOLESALERS, MOCK_INTERNAL_WHOLESALERS } from "@/lib/mock-data";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = isSalesforceConfigured();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-6 bg-slate-50 px-6 text-center">
      <div>
        <h1 className="text-2xl font-extrabold text-brand-green">Loop</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to see your route.</p>
      </div>

      {error && (
        <p className="w-full rounded-xl border-2 border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {decodeURIComponent(error)}
        </p>
      )}

      {configured ? (
        <a
          href="/api/auth/login"
          className="flex h-14 w-full items-center justify-center rounded-xl bg-brand-teal text-base font-semibold text-white active:opacity-80"
        >
          Sign in with Salesforce
        </a>
      ) : (
        <div className="flex w-full flex-col gap-4">
          <p className="rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-xs text-amber-800">
            Salesforce isn&apos;t connected yet — pick a mock account below to preview the app.
            This screen is replaced by real Salesforce sign-in once a Connected App is configured.
          </p>

          <div className="flex flex-col gap-2 text-left">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
              External Wholesaler
            </span>
            {MOCK_WHOLESALERS.map((w) => (
              <a
                key={w.id}
                href={`/api/auth/mock-login?role=external&wholesaler=${w.id}`}
                className="flex h-12 items-center justify-center rounded-xl border-2 border-slate-900 text-sm font-semibold text-slate-900 active:bg-slate-100"
              >
                Continue as {w.name}
              </a>
            ))}
          </div>

          <div className="flex flex-col gap-2 text-left">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Internal Wholesaler
            </span>
            {MOCK_INTERNAL_WHOLESALERS.map((i) => (
              <a
                key={i.id}
                href={`/api/auth/mock-login?role=internal&internal=${i.id}`}
                className="flex h-12 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white active:bg-slate-700"
              >
                Continue as {i.name}
              </a>
            ))}
          </div>

          <div className="flex flex-col gap-2 text-left">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Admin (View All)
            </span>
            <a
              href="/api/auth/mock-login?role=admin"
              className="flex h-12 items-center justify-center rounded-xl border-2 border-indigo-600 text-sm font-semibold text-indigo-700 active:bg-indigo-50"
            >
              Continue as Admin
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
