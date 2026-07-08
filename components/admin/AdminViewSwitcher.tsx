"use client";

import { useState } from "react";
import type { Session } from "@/lib/session";
import type { LoopStop } from "@/lib/types";
import LoopView from "@/components/LoopView";
import CheckFitTool from "@/components/internal/CheckFitTool";

type ViewMode = "internal" | "external";

/**
 * The "View All" admin role isn't tied to one wholesaler's own schedule, so
 * it needs to pick which side of the app to look at — and, on the external
 * side, which wholesaler's loop to preview.
 */
export default function AdminViewSwitcher({ currentUser }: { currentUser: Session }) {
  const externals = currentUser.assignedExternals ?? [];
  const [mode, setMode] = useState<ViewMode>("internal");
  const [wholesalerId, setWholesalerId] = useState(externals[0]?.id ?? "");
  // Shared between the two views so a firm added in Internal view shows up
  // immediately in External view for the same wholesaler — otherwise each
  // component's own session-local state would be invisible to the other.
  const [addedStops, setAddedStops] = useState<LoopStop[]>([]);

  const subject = externals.find((w) => w.id === wholesalerId);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <div className="flex flex-wrap items-center justify-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex rounded-lg border border-slate-300 p-0.5">
          <button
            onClick={() => setMode("internal")}
            className={`h-9 rounded-md px-4 text-sm font-bold ${
              mode === "internal" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Internal view
          </button>
          <button
            onClick={() => setMode("external")}
            className={`h-9 rounded-md px-4 text-sm font-bold ${
              mode === "external" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            External view
          </button>
        </div>

        {mode === "external" && externals.length > 0 && (
          <select
            value={wholesalerId}
            onChange={(e) => setWholesalerId(e.target.value)}
            className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700"
          >
            {externals.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex-1">
        {mode === "internal" ? (
          <CheckFitTool
            currentUser={currentUser}
            addedStops={addedStops}
            onAddedStopsChange={setAddedStops}
          />
        ) : externals.length === 0 ? (
          <div className="mx-auto flex max-w-lg flex-col items-center gap-2 p-10 text-center text-slate-500">
            <span className="text-3xl">🗂️</span>
            <p className="font-semibold">No external wholesalers found in Salesforce.</p>
          </div>
        ) : (
          <LoopView currentUser={currentUser} subject={subject} extraStops={addedStops} />
        )}
      </div>
    </div>
  );
}
