"use client";

import { useState } from "react";
import type { LoopStop, Address } from "./types";
import type { ScheduleVisitResult } from "./salesforce/loop-write";

export type ScheduleState = "idle" | "confirming" | "submitting" | "success" | "error";

export type ScheduleVisitParams = {
  wholesalerId: string;
  wholesalerEmail: string;
  timeZone: string;
  accountId: string | null;
  firmName: string;
  address: Address;
  lat: number;
  lng: number;
  meetingDate: string;
  meetingTime: string;
  durationMinutes: number;
  lastActivityDate?: string | null;
  locationAum?: number | null;
};

/**
 * Shared "Add to Schedule" write flow — POSTs to /api/loop/schedule and
 * appends the resulting stop to the caller's addedStops state on success.
 * Extracted from CheckFitTool.tsx's original submitSchedule so the manual
 * candidate-firm form and the Suggested FAs list (components/internal/SuggestedFAs.tsx)
 * share one implementation instead of forking the same fetch/error handling.
 * One instance of this hook tracks one in-flight schedule action — a caller
 * that renders many independent "Add" buttons (like a suggestions list)
 * should call this once per row, not share a single instance across rows.
 */
export function useScheduleVisit(setAddedStops: (updater: (prev: LoopStop[]) => LoopStop[]) => void) {
  const [state, setState] = useState<ScheduleState>("idle");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setState("idle");
    setError(null);
  };

  const requestConfirm = () => setState("confirming");

  const submit = async (params: ScheduleVisitParams): Promise<boolean> => {
    setState("submitting");
    try {
      const res = await fetch("/api/loop/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const result: ScheduleVisitResult = await res.json();
      if (result.success) {
        setAddedStops((prev) => [
          ...prev,
          {
            id: result.recordId,
            sfId: result.recordId,
            mockRecord: result.mocked,
            wholesalerId: params.wholesalerId,
            accountId: params.accountId ?? undefined,
            lastActivityDate: params.lastActivityDate ?? null,
            locationAum: params.locationAum ?? null,
            firmName: params.firmName,
            address: params.address,
            lat: params.lat,
            lng: params.lng,
            meetingDate: params.meetingDate,
            meetingTime: params.meetingTime,
            durationMinutes: params.durationMinutes,
          },
        ]);
        setState("success");
        return true;
      }
      setError(result.error ?? "Something went wrong.");
      setState("error");
      return false;
    } catch (err) {
      console.error("Failed to schedule visit:", err);
      setError("Network error — please try again.");
      setState("error");
      return false;
    }
  };

  return { state, error, submit, requestConfirm, reset };
}
