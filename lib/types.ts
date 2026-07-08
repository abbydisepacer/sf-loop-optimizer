export type Address = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export type Wholesaler = {
  id: string;
  name: string;
  /** Mock stand-in for the Salesforce Lookup naming their assigned Internal Wholesaler. */
  internalWholesalerId: string;
};

export type LoopStop = {
  id: string;
  /** Salesforce record ID, for traceability back to the source record. */
  sfId?: string;
  /** Which external wholesaler this stop belongs to. */
  wholesalerId: string;
  firmName: string;
  address: Address;
  lat: number;
  lng: number;
  /** ISO date, e.g. "2026-07-06". */
  meetingDate: string;
  /**
   * 24h "HH:mm" fixed appointment time set by the internal wholesaler, or
   * null if this stop has no fixed time and can be slotted in around the
   * fixed appointments.
   */
  meetingTime: string | null;
  durationMinutes: number;
  notes?: string;
  /**
   * True if sfId came from the mocked write fallback rather than a real
   * Salesforce Event — lets the UI say honestly whether this was actually
   * saved. Only meaningful for stops added this session.
   */
  mockRecord?: boolean;
};

export type LegStatus = "ok" | "tight" | "conflict";

export type Leg = {
  fromStopId: string;
  toStopId: string;
  driveMinutes: number;
  driveMiles: number;
  /** Minutes between end of the previous meeting and start of the next. */
  availableMinutes: number | null;
  bufferMinutes: number | null;
  status: LegStatus;
  /**
   * "estimate" until the Google Routes API call resolves, "google" once real
   * data has replaced it, or "unavailable" if that call was tried and failed
   * (e.g. API quota) — the straight-line estimate is what's shown instead.
   */
  source: "estimate" | "google" | "unavailable";
  /** Google-encoded driving route polyline, set once source is "google". */
  polyline?: string;
};

export type ScheduledStop = LoopStop & {
  sequence: number;
  /** Set for flexible (no fixed meetingTime) stops once slotted into the route. */
  suggestedTime?: string;
  isFlexible: boolean;
};

export type Loop = {
  date: string;
  stops: ScheduledStop[];
  legs: Leg[];
};
