import { prisma as _prisma } from "../../config/database";
import { PrismaClient } from "@prisma/client";
import { AcbuRate } from "@prisma/client";

// Cast to PrismaClient to resolve the Accelerate union-type TS2349 error (#717).
const prisma = _prisma as unknown as PrismaClient;

const TTL_MS = 10_000; // 10 seconds

let cached: AcbuRate | null = null;
let expiresAt = 0;
let inflight: Promise<AcbuRate> | null = null;

async function fetchFromDb(): Promise<AcbuRate> {
  const row = await prisma.acbuRate.findFirst({ orderBy: { timestamp: "desc" } });
  if (!row) throw new Error("ACBU rates not available");
  cached = row;
  expiresAt = Date.now() + TTL_MS;
  return row;
}

/**
 * Return the latest AcbuRate, served from an in-memory cache for up to TTL_MS.
 * Concurrent callers during a cache miss share a single DB query (request coalescing).
 */
export async function getLatestAcbuRate(): Promise<AcbuRate> {
  if (cached && Date.now() < expiresAt) {
    return cached;
  }

  if (!inflight) {
    inflight = fetchFromDb().finally(() => {
      inflight = null;
    });
  }

  return inflight;
}

/** Invalidate the cache (e.g. after a new rate is written). */
export function invalidateAcbuRateCache(): void {
  cached = null;
  expiresAt = 0;
}
