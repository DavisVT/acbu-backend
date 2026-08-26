import { createHash, createHmac } from "crypto";

/**
 * Computes a deterministic SHA-256 hash for a Stellar address.
 *
 * Used for blind indexing and privacy compliance (CCPA/BIPA).
 * Allows checking consent preferences without querying or storing plaintext addresses in DB.
 *
 * @param address - Plaintext Stellar public key (G-address) or identifier
 * @param salt - Optional salt string to prepend/key the hash
 * @returns 64-character lowercase hex string representation of the hashed address
 */
export function computeAddressHash(address: string, salt?: string): string {
  if (!address || typeof address !== "string") {
    throw new Error("Address must be a non-empty string");
  }
  const normalized = address.trim();
  if (salt) {
    return createHmac("sha256", salt).update(normalized, "utf8").digest("hex");
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
