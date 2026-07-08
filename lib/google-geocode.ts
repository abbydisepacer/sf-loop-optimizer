export type GeocodeResult = { lat: number; lng: number; formattedAddress: string };

/**
 * Resolves a freeform address string to real coordinates via the Places
 * API (New) Text Search endpoint — used when the candidate address wasn't
 * picked from the autocomplete dropdown (e.g. typed and left as-is), so we
 * never fall back to a guessed location.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set");
  }

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.location,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: address }),
  });

  if (!res.ok) {
    throw new Error(`Geocoding failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const place = data.places?.[0];
  if (!place?.location) return null;

  return {
    lat: place.location.latitude,
    lng: place.location.longitude,
    formattedAddress: place.formattedAddress ?? address,
  };
}
