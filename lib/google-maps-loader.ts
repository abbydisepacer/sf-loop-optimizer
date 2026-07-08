import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

let optionsSet = false;

/**
 * NEXT_PUBLIC_-prefixed so it's available client-side — Maps JavaScript
 * API keys are meant to be used in the browser and secured with HTTP
 * referrer restrictions in the Google Cloud Console, not kept secret
 * like a server key.
 */
function ensureOptions() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set");
  }
  if (!optionsSet) {
    setOptions({ key: apiKey, v: "weekly" });
    optionsSet = true;
  }
}

export async function loadPlacesLibrary(): Promise<google.maps.PlacesLibrary> {
  ensureOptions();
  return importLibrary("places");
}

export async function loadMapLibraries(): Promise<
  [google.maps.CoreLibrary, google.maps.MapsLibrary, google.maps.MarkerLibrary, google.maps.GeometryLibrary]
> {
  ensureOptions();
  return Promise.all([
    importLibrary("core"),
    importLibrary("maps"),
    importLibrary("marker"),
    importLibrary("geometry"),
  ]);
}
