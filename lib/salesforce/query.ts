import { SALESFORCE_API_VERSION } from "./auth";

/** Escapes single quotes for SOQL/SOSL string literals — required to safely interpolate user input. */
export function escapeSoql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function runQuery<T>(accessToken: string, instanceUrl: string, soql: string): Promise<T[]> {
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

export async function runSearch<T>(accessToken: string, instanceUrl: string, sosl: string): Promise<T[]> {
  const res = await fetch(
    `${instanceUrl}/services/data/${SALESFORCE_API_VERSION}/search/?q=${encodeURIComponent(sosl)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`Salesforce search failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.searchRecords ?? [];
}
