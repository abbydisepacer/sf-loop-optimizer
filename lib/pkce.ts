import { randomBytes, createHash } from "crypto";

/**
 * RFC 7636 PKCE pair. Node's base64url encoding is already unpadded, so no
 * manual "+/=" cleanup is needed.
 */
export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}
