import { escapeSoql, runQuery, runSearch } from "./query";
import { isPhoneLikeQuery } from "./accounts";
import type { Address } from "@/lib/types";

export type ContactSearchResult = {
  id: string;
  name: string;
  title: string | null;
  phone: string | null;
  mobilePhone: string | null;
  accountId: string;
  accountName: string;
  address: Address;
  /** Null when the parent Account has no geocoded Billing Address on file. */
  lat: number | null;
  lng: number | null;
  lastActivityDate: string | null;
  /** Custom field, gated on SALESFORCE_LOCATION_AUM_FIELD — see lib/salesforce/accounts.ts. */
  locationAum: number | null;
  /** Custom field, gated on SALESFORCE_CADENCE_FIELD — typical days between this FA's meetings. */
  cadenceDays: number | null;
  /** Custom field, gated on SALESFORCE_PRIORITY_LIST_FIELD. */
  priorityListValue: string | null;
  /** Custom field, gated on SALESFORCE_SHARE_ADJUSTMENT_FIELD. */
  shareAdjustmentValue: unknown;
  /** Custom field, gated on SALESFORCE_BIG_CALENDAR_FIELD. */
  bigCalendarValue: unknown;
};

const AUM_FIELD = process.env.SALESFORCE_LOCATION_AUM_FIELD;
const CADENCE_FIELD = process.env.SALESFORCE_CADENCE_FIELD;
const PRIORITY_LIST_FIELD = process.env.SALESFORCE_PRIORITY_LIST_FIELD;
const SHARE_ADJUSTMENT_FIELD = process.env.SALESFORCE_SHARE_ADJUSTMENT_FIELD;
const BIG_CALENDAR_FIELD = process.env.SALESFORCE_BIG_CALENDAR_FIELD;
const EXCLUDE_STATUS_FIELD = process.env.SALESFORCE_EXCLUDE_STATUS_FIELD;
const EXCLUDE_STATUS_VALUES = (process.env.SALESFORCE_EXCLUDE_STATUS_VALUES ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

type ContactRecord = {
  Id: string;
  Name: string;
  Title: string | null;
  Phone: string | null;
  MobilePhone: string | null;
  AccountId: string;
  Account: {
    Name: string;
    BillingStreet: string | null;
    BillingCity: string | null;
    BillingState: string | null;
    BillingPostalCode: string | null;
    BillingLatitude: number | null;
    BillingLongitude: number | null;
    LastActivityDate: string | null;
  } | null;
};

/** Reads a dynamically-named custom field off a record without an index signature on ContactRecord itself. */
function getCustomField(record: object, fieldName: string): unknown {
  return (record as Record<string, unknown>)[fieldName];
}

const CONTACT_FIELDS = [
  "Id",
  "Name",
  "Title",
  "Phone",
  "MobilePhone",
  "AccountId",
  "Account.Name",
  "Account.BillingStreet",
  "Account.BillingCity",
  "Account.BillingState",
  "Account.BillingPostalCode",
  "Account.BillingLatitude",
  "Account.BillingLongitude",
  "Account.LastActivityDate",
  ...(AUM_FIELD ? [`Account.${AUM_FIELD}`] : []),
  ...(CADENCE_FIELD ? [CADENCE_FIELD] : []),
  ...(PRIORITY_LIST_FIELD ? [PRIORITY_LIST_FIELD] : []),
  ...(SHARE_ADJUSTMENT_FIELD ? [SHARE_ADJUSTMENT_FIELD] : []),
  ...(BIG_CALENDAR_FIELD ? [BIG_CALENDAR_FIELD] : []),
].join(", ");

function mapContactRecord(r: ContactRecord): ContactSearchResult {
  const rawAum = AUM_FIELD && r.Account ? getCustomField(r.Account, AUM_FIELD) : undefined;
  const rawCadence = CADENCE_FIELD ? getCustomField(r, CADENCE_FIELD) : undefined;
  const rawPriority = PRIORITY_LIST_FIELD ? getCustomField(r, PRIORITY_LIST_FIELD) : undefined;
  const rawShareAdj = SHARE_ADJUSTMENT_FIELD ? getCustomField(r, SHARE_ADJUSTMENT_FIELD) : undefined;
  const rawBigCal = BIG_CALENDAR_FIELD ? getCustomField(r, BIG_CALENDAR_FIELD) : undefined;

  return {
    id: r.Id,
    name: r.Name,
    title: r.Title ?? null,
    phone: r.Phone ?? null,
    mobilePhone: r.MobilePhone ?? null,
    accountId: r.AccountId,
    accountName: r.Account?.Name ?? "",
    address: {
      street: r.Account?.BillingStreet ?? "",
      city: r.Account?.BillingCity ?? "",
      state: r.Account?.BillingState ?? "",
      zip: r.Account?.BillingPostalCode ?? "",
    },
    lat: r.Account?.BillingLatitude ?? null,
    lng: r.Account?.BillingLongitude ?? null,
    lastActivityDate: r.Account?.LastActivityDate ?? null,
    locationAum: typeof rawAum === "number" ? rawAum : null,
    cadenceDays: typeof rawCadence === "number" ? rawCadence : null,
    priorityListValue: typeof rawPriority === "string" && rawPriority ? rawPriority : null,
    shareAdjustmentValue: rawShareAdj ?? null,
    bigCalendarValue: rawBigCal ?? null,
  };
}

async function searchContactsByPhone(
  accessToken: string,
  instanceUrl: string,
  query: string
): Promise<ContactSearchResult[]> {
  const digits = query.replace(/\D/g, "").slice(-10);
  if (digits.length < 7) return [];

  const sosl = `FIND {${digits}} IN PHONE FIELDS RETURNING Contact(${CONTACT_FIELDS})`;
  const records = await runSearch<ContactRecord & { attributes: { type: string } }>(accessToken, instanceUrl, sosl);
  return records.map(mapContactRecord).slice(0, 10);
}

/**
 * Name/phone typeahead search over Contacts directly — unlike
 * searchAccountsByPhone in accounts.ts, this keeps Contact-level fields
 * (own Phone, Title) instead of resolving back to the parent Account.
 */
export async function searchContacts(
  accessToken: string,
  instanceUrl: string,
  query: string
): Promise<ContactSearchResult[]> {
  if (isPhoneLikeQuery(query)) {
    return searchContactsByPhone(accessToken, instanceUrl, query);
  }
  const escaped = escapeSoql(query.trim().slice(0, 100));
  const soql = `SELECT ${CONTACT_FIELDS} FROM Contact WHERE Name LIKE '%${escaped}%' ORDER BY Name LIMIT 10`;
  const records = await runQuery<ContactRecord>(accessToken, instanceUrl, soql);
  return records.map(mapContactRecord);
}

/**
 * Candidate pool for the Suggested FAs feature (lib/salesforce/fa-suggestions.ts)
 * — Contacts whose parent Account is geocoded and within radiusMiles of a
 * point (typically the centroid of a wholesaler's day). Excludes Accounts
 * already on that day's schedule, and (if configured) Contacts whose
 * SALESFORCE_EXCLUDE_STATUS_FIELD value is in SALESFORCE_EXCLUDE_STATUS_VALUES
 * (bad number/all set/retired/on hold, etc).
 */
export async function findContactsNearLocation(
  accessToken: string,
  instanceUrl: string,
  point: { lat: number; lng: number },
  opts: { radiusMiles: number; excludeAccountIds: string[]; limit?: number }
): Promise<ContactSearchResult[]> {
  const distanceExpr = `DISTANCE(Account.BillingAddress, GEOLOCATION(${point.lat},${point.lng}), 'mi')`;

  const excludeClause = opts.excludeAccountIds.length
    ? ` AND AccountId NOT IN (${opts.excludeAccountIds.map((id) => `'${escapeSoql(id)}'`).join(",")})`
    : "";

  const statusClause =
    EXCLUDE_STATUS_FIELD && EXCLUDE_STATUS_VALUES.length
      ? ` AND (${EXCLUDE_STATUS_FIELD} = null OR ${EXCLUDE_STATUS_FIELD} NOT IN (${EXCLUDE_STATUS_VALUES.map(
          (v) => `'${escapeSoql(v)}'`
        ).join(",")}))`
      : "";

  const soql =
    `SELECT ${CONTACT_FIELDS} FROM Contact ` +
    `WHERE AccountId != null AND Account.BillingLatitude != null AND Account.BillingLongitude != null ` +
    `AND ${distanceExpr} < ${opts.radiusMiles}` +
    excludeClause +
    statusClause +
    ` ORDER BY ${distanceExpr} LIMIT ${opts.limit ?? 300}`;

  const records = await runQuery<ContactRecord>(accessToken, instanceUrl, soql);
  return records.map(mapContactRecord);
}
