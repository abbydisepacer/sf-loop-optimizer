import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/google-geocode";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json({ result: null });
  }

  try {
    const result = await geocodeAddress(address);
    return NextResponse.json({ result });
  } catch (err) {
    console.error("Geocoding request failed:", err);
    return NextResponse.json({ result: null, error: "Geocoding failed" }, { status: 502 });
  }
}
