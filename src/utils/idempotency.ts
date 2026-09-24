import type { Request } from "express";

/**
 * Maximum length of the persisted idempotency key.
 * Mirrors the `transactions.idempotency_key` VarChar(255) column.
 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/**
 * Extracts the idempotency key from the request.
 * Checks the Idempotency-Key header first, then the body.
 */
export function extractIdempotencyKey(req: Request): string | undefined {
  const headerKey = req.header("Idempotency-Key");
  if (headerKey) return headerKey;

  const bodyKey = (req.body as { idempotencyKey?: unknown } | undefined)
    ?.idempotencyKey;
  return typeof bodyKey === "string" ? bodyKey : undefined;
}

/**
 * Namespaces a raw idempotency key by its owning principal (user id).
 *
 * `Transaction.idempotencyKey` is globally unique, so an unscoped
 * partner-supplied key (e.g. `fintech_tx_id`) lets one user collide into
 * another user's transaction — the second submitter would receive a 202
 * referencing somebody else's transaction, and the legitimate deposit is
 * blocked (Pi-Defi-world/acbu-backend#985). Scoping the key by the
 * authenticated user removes the cross-user collision.
 *
 * The scope prefix counts against the 255-character column limit, so the
 * raw key is truncated to keep the stored value within bounds.
 */
export function scopeIdempotencyKey(scope: string, rawKey: string): string {
  const maxRawLength = Math.max(
    1,
    IDEMPOTENCY_KEY_MAX_LENGTH - scope.length - 1,
  );
  const safeKey =
    rawKey.length > maxRawLength ? rawKey.slice(0, maxRawLength) : rawKey;
  return `${scope}:${safeKey}`;
}
