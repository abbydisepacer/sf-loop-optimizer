export type RouteResult = {
  durationSeconds: number;
  distanceMeters: number;
  encodedPolyline: string;
};

/**
 * Calls the Google Routes API (computeRoutes) for a single origin/destination
 * pair — real driving duration, distance, and an encoded polyline in one
 * request. Server-side only: the field mask is sent via a request header,
 * which browser-side Places/Maps JS calls don't need but this REST endpoint
 * requires.
 */
export async function computeRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<RouteResult> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set");
  }

  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      polylineEncoding: "ENCODED_POLYLINE",
    }),
  });

  if (!res.ok) {
    throw new Error(`Google Routes API failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) {
    throw new Error("Google Routes API returned no route");
  }

  return {
    durationSeconds: parseInt(String(route.duration).replace("s", ""), 10),
    distanceMeters: route.distanceMeters,
    encodedPolyline: route.polyline.encodedPolyline,
  };
}
