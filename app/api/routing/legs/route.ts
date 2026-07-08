import { NextRequest, NextResponse } from "next/server";
import { computeRoute } from "@/lib/google-routes";

type Point = { lat: number; lng: number };

export async function POST(request: NextRequest) {
  const body = await request.json();
  const points: Point[] = body?.points ?? [];

  if (points.length < 2) {
    return NextResponse.json({ legs: [] });
  }

  const legs = await Promise.all(
    points.slice(0, -1).map(async (origin, i) => {
      const destination = points[i + 1];
      try {
        return await computeRoute(origin, destination);
      } catch (err) {
        console.error(`Routes API failed for leg ${i}:`, err);
        return null;
      }
    })
  );

  return NextResponse.json({ legs });
}
