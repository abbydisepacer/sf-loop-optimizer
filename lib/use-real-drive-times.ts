"use client";

import { useEffect, useState } from "react";
import { classify } from "./routing-engine";
import type { Loop } from "./types";

const DEBOUNCE_MS = 400;

type LegApiResult = { durationSeconds: number; distanceMeters: number; encodedPolyline: string } | null;

/**
 * Enriches a loop's legs with real Google Routes API drive times and route
 * polylines, replacing the initial estimate. Returns the estimate-based
 * loop immediately (so the UI never blocks on network), then updates once
 * the real data arrives. Debounced so rapid loop changes (e.g. typing a
 * candidate address) don't fire a request per keystroke.
 */
export function useRealDriveTimes(loop: Loop): Loop {
  const [enriched, setEnriched] = useState(loop);
  const [trackedLoop, setTrackedLoop] = useState(loop);

  // Reset to the fresh estimate as soon as the input loop changes, during
  // render rather than in an effect (React's recommended pattern for this).
  if (loop !== trackedLoop) {
    setTrackedLoop(loop);
    setEnriched(loop);
  }

  useEffect(() => {
    if (loop.stops.length < 2) return;

    const timer = setTimeout(() => {
      const points = loop.stops.map((s) => ({ lat: s.lat, lng: s.lng }));

      fetch("/api/routing/legs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points }),
      })
        .then((res) => res.json())
        .then((data: { legs: LegApiResult[] }) => {
          setEnriched((current) => ({
            ...current,
            legs: current.legs.map((leg, i) => {
              const real = data.legs[i];
              // `real` is null when the server tried the Routes API for this
              // leg and it failed (e.g. quota) — flag it as unavailable
              // rather than leaving it looking like a pending "estimate".
              if (!real) return leg.source === "estimate" ? { ...leg, source: "unavailable" } : leg;

              const driveMinutes = Math.round(real.durationSeconds / 60);
              const driveMiles = Math.round((real.distanceMeters / 1609.34) * 10) / 10;
              const bufferMinutes =
                leg.availableMinutes !== null ? leg.availableMinutes - driveMinutes : null;

              return {
                ...leg,
                driveMinutes,
                driveMiles,
                bufferMinutes,
                status: classify(bufferMinutes),
                source: "google" as const,
                polyline: real.encodedPolyline,
              };
            }),
          }));
        })
        .catch((err) => console.error("Failed to fetch real drive times:", err));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [loop]);

  return enriched;
}
