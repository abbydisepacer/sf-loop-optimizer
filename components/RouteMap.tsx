"use client";

import { useEffect, useRef } from "react";
import { loadMapLibraries } from "@/lib/google-maps-loader";
import { isSameLocation } from "@/lib/routing-engine";
import type { ScheduledStop, Leg, LegStatus } from "@/lib/types";

const STATUS_COLOR: Record<LegStatus, string> = {
  ok: "#4f46e5", // indigo-600 — was slate-500, too faint against the map tiles
  tight: "#d97706", // amber-600
  conflict: "#dc2626", // red-600
};

const PHILLY_SUBURBS_CENTER = { lat: 40.05, lng: -75.4 };

// A Map ID is required to use AdvancedMarkerElement. DEMO_MAP_ID works for
// development, but has no cloud-based style attached, so create a real Map
// ID in the Google Cloud Console (with the "poi" feature type turned off)
// for production and set NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID to it.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

/**
 * Draws each leg as the real Google-computed driving route once available
 * (leg.polyline), falling back to a straight "as the crow flies" connector
 * for legs where that hasn't loaded yet or the Routes API call failed.
 * Turn-by-turn navigation itself is still left to the native Maps app deep
 * links — this is an overview for reviewing a wholesaler's day. Shared by
 * both the internal Check-Fit tool and the external's own loop view.
 */
export default function RouteMap({
  stops,
  legs,
  candidateId,
}: {
  stops: ScheduledStop[];
  legs: Leg[];
  candidateId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let cancelled = false;

    loadMapLibraries()
      .then(([core, maps, marker, geometry]) => {
        if (cancelled || !containerRef.current) return;

        if (!mapRef.current) {
          mapRef.current = new maps.Map(containerRef.current, {
            center: PHILLY_SUBURBS_CENTER,
            zoom: 10,
            disableDefaultUI: true,
            zoomControl: true,
            // AdvancedMarkerElement requires a Map ID. POI labels are hidden
            // via that Map ID's cloud-based style (see the MAP_ID comment
            // above) rather than the inline `styles` option, which a map
            // with a Map ID ignores.
            mapId: MAP_ID,
          });
        }
        const map = mapRef.current;

        markersRef.current.forEach((m) => (m.map = null));
        markersRef.current = [];
        polylinesRef.current.forEach((line) => line.setMap(null));
        polylinesRef.current = [];

        if (stops.length === 0) return;

        const bounds = new core.LatLngBounds();

        // Stops at the same location (e.g. a candidate visit back-to-back
        // with an existing stop at the same address) only get one pin —
        // stacking two identical markers on top of each other is just
        // visual clutter, and only the first is ever reachable to click.
        const placedLocations: { lat: number; lng: number }[] = [];

        stops.forEach((stop) => {
          bounds.extend({ lat: stop.lat, lng: stop.lng });
          if (placedLocations.some((loc) => isSameLocation(loc, stop))) return;
          placedLocations.push({ lat: stop.lat, lng: stop.lng });

          const isCandidate = stop.id === candidateId;
          const pinContent = document.createElement("div");
          pinContent.style.width = "28px";
          pinContent.style.height = "28px";
          pinContent.style.borderRadius = "50%";
          pinContent.style.display = "flex";
          pinContent.style.alignItems = "center";
          pinContent.style.justifyContent = "center";
          pinContent.style.backgroundColor = isCandidate ? "#eb7e24" : "#0f172a"; // brand orange for the candidate
          pinContent.style.border = "2px solid #ffffff";
          pinContent.style.boxShadow = "0 1px 3px rgba(0,0,0,0.4)";
          pinContent.style.color = "#ffffff";
          pinContent.style.fontWeight = "bold";
          pinContent.style.fontSize = "12px";
          pinContent.textContent = String(stop.sequence);

          const pin = new marker.AdvancedMarkerElement({
            map,
            position: { lat: stop.lat, lng: stop.lng },
            content: pinContent,
            title: stop.firmName,
            zIndex: isCandidate ? 999 : undefined,
          });
          markersRef.current.push(pin);
        });

        for (let i = 0; i < stops.length - 1; i++) {
          const leg = legs[i];
          const isRealRoute = Boolean(leg.polyline);
          const path = leg.polyline
            ? geometry.encoding.decodePath(leg.polyline)
            : [
                { lat: stops[i].lat, lng: stops[i].lng },
                { lat: stops[i + 1].lat, lng: stops[i + 1].lng },
              ];
          const line = new maps.Polyline({
            map,
            path,
            strokeColor: STATUS_COLOR[leg.status],
            strokeOpacity: isRealRoute ? 0.85 : 0,
            strokeWeight: leg.status === "ok" ? 3 : 4,
            // No real Routes API polyline for this leg (still loading, or the
            // call failed) — dash the straight-line connector so it doesn't
            // read as an actual driving route.
            icons: isRealRoute
              ? undefined
              : [
                  {
                    icon: { path: "M 0,-1 0,1", strokeOpacity: 0.85, scale: 5 },
                    offset: "0",
                    repeat: "16px",
                  },
                ],
          });
          polylinesRef.current.push(line);
        }

        map.fitBounds(bounds, 56);
      })
      .catch((err) => {
        console.error("Google Map unavailable:", err);
        if (errorRef.current) errorRef.current.hidden = false;
      });

    return () => {
      cancelled = true;
    };
  }, [stops, legs, candidateId]);

  return (
    <div className="relative h-full min-h-[320px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
      <div ref={containerRef} className="h-full w-full" />
      <p
        ref={errorRef}
        hidden
        className="absolute inset-0 flex items-center justify-center bg-slate-100 px-6 text-center text-sm text-slate-500"
      >
        Map unavailable right now.
      </p>
    </div>
  );
}
