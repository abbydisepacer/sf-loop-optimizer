import { isPhoneLikeQuery, type AccountSearchResult } from "./salesforce/accounts";

/**
 * Stands in for Salesforce Accounts when Salesforce isn't configured yet —
 * lets the "search Salesforce or type a new firm" flow have real, correctly
 * geocoded firms to find. Independent of any mock loop/schedule data (there
 * isn't any — see mock-data.ts).
 */
export const MOCK_ACCOUNTS: AccountSearchResult[] = [
  {
    id: "a0B1x0000006abcEAA",
    name: "Hamilton Wealth Partners",
    address: { street: "100 Matsonford Rd", city: "Wayne", state: "PA", zip: "19087" },
    lat: 40.0496407,
    lng: -75.3567947,
  },
  {
    id: "a0B1x0000006abdEAA",
    name: "Brandywine Capital Advisors",
    address: { street: "22 W Market St", city: "West Chester", state: "PA", zip: "19382" },
    lat: 39.9591974,
    lng: -75.6051139,
  },
  {
    id: "a0B1x0000006abeEAA",
    name: "Chester County Financial Group",
    address: { street: "1 Liberty Blvd", city: "Exton", state: "PA", zip: "19341" },
    lat: 40.0557138,
    lng: -75.5268798,
  },
  {
    id: "a0B1x0000006abfEAA",
    name: "Main Line Investment Partners",
    address: { street: "919 Conestoga Rd", city: "Bryn Mawr", state: "PA", zip: "19010" },
    lat: 40.0259252,
    lng: -75.3353822,
  },
  {
    id: "a0B1x0000006abgEAA",
    name: "Valley Forge Retirement Advisors",
    address: { street: "1000 First Ave", city: "King of Prussia", state: "PA", zip: "19406" },
    lat: 40.0959898,
    lng: -75.4077401,
  },
  {
    id: "a0B1x0000006abhEAA",
    name: "Blue Bell Asset Management",
    address: { street: "725 Skippack Pike", city: "Blue Bell", state: "PA", zip: "19422" },
    lat: 40.1552519,
    lng: -75.2692209,
  },
  {
    id: "a0B1x0000006abiEAA",
    name: "Radnor Ridge Advisory",
    address: { street: "555 E Lancaster Ave", city: "Radnor", state: "PA", zip: "19087" },
    lat: 40.041191,
    lng: -75.3676536,
  },
  {
    id: "a0B1x0000006abjEAA",
    name: "Great Valley Wealth Management",
    address: { street: "10 Great Valley Pkwy", city: "Malvern", state: "PA", zip: "19355" },
    lat: 40.0631434,
    lng: -75.5359146,
  },
  {
    id: "a0B1x0000006abkEAA",
    name: "Devon Square Capital",
    address: { street: "156 W Lancaster Ave", city: "Devon", state: "PA", zip: "19333" },
    lat: 40.0455708,
    lng: -75.422765,
  },
  {
    id: "a0B1x0000006ablEAA",
    name: "Plymouth Meeting Advisory Group",
    address: { street: "500 W Germantown Pike", city: "Plymouth Meeting", state: "PA", zip: "19462" },
    lat: 40.1142712,
    lng: -75.2846715,
  },
  {
    id: "a0B1x0000006abmEAA",
    name: "Ambler Financial Partners",
    address: { street: "45 N Main St", city: "Ambler", state: "PA", zip: "19002" },
    lat: 40.1549568,
    lng: -75.2247868,
  },
  {
    id: "a0B1x0000006abnEAA",
    name: "Doylestown Wealth Advisory",
    address: { street: "77 W Court St", city: "Doylestown", state: "PA", zip: "18901" },
    lat: 40.3097953,
    lng: -75.1321629,
  },
  {
    id: "a0B1x0000006abzEAA",
    name: "Wayne Wealth Consultants",
    address: { street: "789 Lancaster Ave", city: "Wayne", state: "PA", zip: "19087" },
    lat: 40.0484173,
    lng: -75.4108985,
  },
  {
    // Demonstrates an Account with no geocoded Billing Address on file —
    // a real possibility for orgs without Account auto-geocoding enabled.
    id: "a0B1x0000006aczEAA",
    name: "Devon Manor Advisors",
    address: { street: "212 W Lancaster Ave", city: "Devon", state: "PA", zip: "19333" },
    lat: null,
    lng: null,
  },
];

// Only for matching in searchMockAccounts — not part of AccountSearchResult,
// since real search results never return a phone number today.
const MOCK_ACCOUNT_PHONES: Record<string, string> = {
  "a0B1x0000006abcEAA": "610-555-0142", // Hamilton Wealth Partners
  "a0B1x0000006abdEAA": "610-555-0198", // Brandywine Capital Advisors
};

export function searchMockAccounts(query: string): AccountSearchResult[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  if (isPhoneLikeQuery(query)) {
    const digits = query.replace(/\D/g, "");
    return MOCK_ACCOUNTS.filter((a) => {
      const phone = MOCK_ACCOUNT_PHONES[a.id];
      return phone && phone.replace(/\D/g, "").includes(digits);
    }).slice(0, 10);
  }

  return MOCK_ACCOUNTS.filter((a) => a.name.toLowerCase().includes(normalized)).slice(0, 10);
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Mirrors findAccountsNearAddress's ~0.1 mile proximity match for dev/testing without Salesforce. */
export function findMockAccountsNearAddress(point: { lat: number; lng: number }): AccountSearchResult[] {
  return MOCK_ACCOUNTS.filter((a) => a.lat !== null && a.lng !== null && haversineMiles(point, { lat: a.lat, lng: a.lng }) < 0.1);
}
