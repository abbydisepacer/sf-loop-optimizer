import type { Address } from "./types";

export function formatAddress(address: Address): string {
  const cityStateZip = [address.city, [address.state, address.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [address.street, cityStateZip].filter(Boolean).join(", ");
}

export function appleMapsUrl(address: Address): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(formatAddress(address))}`;
}

export function googleMapsUrl(address: Address): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    formatAddress(address)
  )}`;
}
