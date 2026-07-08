import { SALESFORCE_API_VERSION } from "./auth";

export type AccountSearchResult = {
  id: string;
  name: string;
  address: { street: string; city: string; state: string; zip: string };
  /** Null when the Account record has no geocoded Billing Address on file. */
  lat: number | null;
  lng: number | null;
};

type AccountRecord = {
  Id: string;
  Name: string;
  BillingStreet: string | null;
  BillingCity: string | null;
  BillingState: string | null;
  BillingPostalCode: string | null;
  BillingLatitude: number | null;
  BillingLongitude: number | null;
};

/** Escapes single quotes for SOQL string literals — required to safely interpolate user input. */
function escapeSoql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function mapRecord(r: AccountRecord): AccountSearchResult {
  return {
    id: r.Id,
    name: r.Name,
    address: {
      street: r.BillingStreet ?? "",
      city: r.BillingCity ?? "",
      state: r.BillingState ?? "",
      zip: r.BillingPostalCode ?? "",
    },
    lat: r.BillingLatitude ?? null,
    lng: r.BillingLongitude ?? null,
  };
}

const ACCOUNT_FIELDS =
  "Id, Name, BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingLatitude, BillingLongitude";

async function runQuery<T>(accessToken: string, instanceUrl: string, soql: string): Promise<T[]> {
  const res = await fetch(
    `${instanceUrl}/services/data/${SALESFORCE_API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Salesforce query failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.records ?? [];
}

async function runAccountQuery(
  accessToken: string,
  instanceUrl: string,
  soql: string
): Promise<AccountSearchResult[]> {
  const records = await runQuery<AccountRecord>(accessToken, instanceUrl, soql);
  return records.map(mapRecord);
}

/**
 * True when a search query looks like a phone number rather than a name —
 * only phone-ish characters, and at least 7 digits once formatting is
 * stripped. Guards against a name like "3M Advisors" being misread as a
 * phone number just because it contains a digit.
 */
export function isPhoneLikeQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!/^[\d\s\-().+]+$/.test(trimmed)) return false;
  return trimmed.replace(/\D/g, "").length >= 7;
}

type ContactPhoneRecord = {
  attributes: { type: string };
  Id: string;
  Name: string;
  AccountId: string | null;
  // Id isn't selected on this nested relationship — AccountId above is used
  // as the Account's id instead (see the mapping below).
  Account: Omit<AccountRecord, "Id"> | null;
};

type AccountSearchRecord = AccountRecord & { attributes: { type: string } };

/**
 * Searches by phone number instead of name — matches both an Account's own
 * Phone (a firm's front desk) and a Contact's Phone/MobilePhone (more
 * likely what's actually being dialed), since either could be what the
 * wholesaler just called. Results are deduplicated by Account Id.
 *
 * Uses SOSL rather than a SOQL `LIKE '%...%'` query: a leading wildcard
 * can't use an index, so a LIKE-based search means Salesforce scans every
 * Account and Contact record — multiple seconds and growing with org size,
 * confirmed live (2-5s). SOSL's PHONE FIELDS search group is backed by
 * Salesforce's search index instead of a live table scan, and normalizes
 * stored phone formatting automatically — so this also drops the need to
 * guess which punctuation format phone numbers are stored in.
 */
export async function searchAccountsByPhone(
  accessToken: string,
  instanceUrl: string,
  query: string
): Promise<AccountSearchResult[]> {
  const digits = query.replace(/\D/g, "").slice(-10);
  if (digits.length < 7) return [];

  const sosl =
    `FIND {${digits}} IN PHONE FIELDS RETURNING ` +
    `Account(${ACCOUNT_FIELDS}), ` +
    `Contact(Id, Name, AccountId, Account.Name, Account.BillingStreet, Account.BillingCity, Account.BillingState, Account.BillingPostalCode, Account.BillingLatitude, Account.BillingLongitude)`;

  const res = await fetch(`${instanceUrl}/services/data/${SALESFORCE_API_VERSION}/search/?q=${encodeURIComponent(sosl)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Salesforce phone search failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const records: (AccountSearchRecord | ContactPhoneRecord)[] = data.searchRecords ?? [];

  const merged = new Map<string, AccountSearchResult>();
  for (const r of records) {
    if (r.attributes.type === "Account") {
      const account = r as AccountSearchRecord;
      merged.set(account.Id, mapRecord(account));
    } else if (r.attributes.type === "Contact") {
      const contact = r as ContactPhoneRecord;
      // Defensive: a Contact can match on phone with no Account attached, or
      // (rarely) with the nested Account hidden by field-level security.
      if (!contact.Account || !contact.AccountId) continue;
      if (!merged.has(contact.AccountId)) {
        merged.set(contact.AccountId, mapRecord({ ...contact.Account, Id: contact.AccountId }));
      }
    }
  }
  return Array.from(merged.values()).slice(0, 10);
}

/**
 * Searches all Accounts by name — or by phone number, when the query looks
 * like one (see isPhoneLikeQuery/searchAccountsByPhone). No Account
 * type/record type filter for now — narrow this with an additional WHERE
 * clause if you need to exclude non-RIA Accounts later.
 */
export async function searchAccounts(
  accessToken: string,
  instanceUrl: string,
  query: string
): Promise<AccountSearchResult[]> {
  if (isPhoneLikeQuery(query)) {
    return searchAccountsByPhone(accessToken, instanceUrl, query);
  }
  const escaped = escapeSoql(query.trim().slice(0, 100));
  const soql = `SELECT ${ACCOUNT_FIELDS} FROM Account WHERE Name LIKE '%${escaped}%' ORDER BY Name LIMIT 10`;
  return runAccountQuery(accessToken, instanceUrl, soql);
}

/**
 * Finds Accounts at or very near a geocoded point — the reverse of
 * searchAccounts, used when an address is picked first and we want to
 * recognize it as an existing firm. Matches on geographic proximity
 * (within ~0.1 mile) rather than string similarity, so formatting
 * differences between Google's address and Salesforce's don't matter.
 * Falls back to a plain street-text match for Accounts with no BillingAddress
 * geocoded on file yet.
 */
export async function findAccountsNearAddress(
  accessToken: string,
  instanceUrl: string,
  point: { lat: number; lng: number; streetFragment: string }
): Promise<AccountSearchResult[]> {
  const streetEscaped = escapeSoql(point.streetFragment.trim().slice(0, 100));
  const distanceExpr = `DISTANCE(BillingAddress, GEOLOCATION(${point.lat}, ${point.lng}), 'mi')`;
  const soql =
    `SELECT ${ACCOUNT_FIELDS} FROM Account ` +
    `WHERE (${distanceExpr} < 0.1${streetEscaped ? ` OR BillingStreet LIKE '%${streetEscaped}%'` : ""}) ` +
    `ORDER BY ${distanceExpr} LIMIT 5`;
  return runAccountQuery(accessToken, instanceUrl, soql);
}
