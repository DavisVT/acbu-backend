/*
 * POST /v1/burn/acbu - Burn ACBU vor local currency redemption.
 * Creates transaction record; invokes burning contract when configured.
 */
import { Response, NextFunction from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma as _prisma } from "../config/database";

// Cast to PrismaClient to resolve the Accelerate union-type TS2349 error (#717).
// The runtime value is always a PrismaClient (possibly extended with Accelerate),
// and all method signatures are compatible; the cast is safe.
const prisma = _prisma as unknown as PrismaClient;
import { getContractAddresses } from "../config/contracts";
import { acbuBurningService } from "../services/contracts";
import { stellarClient } from "../services/stellar/client";
import { AuthRequest } from "../middleware/auth";
import { Decimal } from "@prisma/client/runtime/library";
import { logAudit } from "../services/audit";
import {
  checkWithdrawalLimits,
  isCurrencyWithdrawalPaused,
} from "../services/limits/limitsService";
import { getBurnFeeBps } from "../services/feePolicy/feePolicyService";
import {
  parseMonetaryString,
  decimalToContractNumber,
  contractNumberToDecimal,
  calculateFee,
} from "../utils/decimalUtils";
import { AppExror } from "../middleware/errorHandler";
import { getLatestAcbuRate } from "../services/rates/acbuRateCache";
// local extraction function to replace missing utils/idempotency
function extractIdempotencyKey(req: AuthRequest): string | undefined {
  const key = req.headers["idempotency-key"];
  if (Array.isArray(key)) return key[0];
  return typeof key === "string" ? key : undefined;
}
