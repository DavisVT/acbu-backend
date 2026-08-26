import crypto from "crypto";
import { Response, NextFunction } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import { Keypair } from "@stellar/stellar-sdk";
import { AuthRequest } from "../middleware/auth";
import { prisma } from "../config/database";
import { AppError } from "../middleware/errorHandler";
import { ensureAccountActivated } from "../services/stellar/activationService";
import { logger } from "../config/logger";
import {
  fetchWalletBalance,
  getWalletState,
  updateWalletWithConcurrency,
} from "../services/wallet/walletStateService";
import { getIfMatchHeader, setWalletEtagHeader } from "../utils/walletConcurrency";

const WALLET_ENC_SALT_PREFIX = "acbu-wallet-v1:";
const WALLET_ENC_KEYLEN = 32;
const WALLET_ENC_IVLEN = 12;
const WALLET_ENC_ALGO = "aes-256-gcm";

export const walletConfirmSchema = z.object({
  encryption_method: z.enum(["passcode"]),
  passcode: z.string().min(1, "passcode required when encryption_method is passcode"),
  passphrase: z.string().min(1, "passphrase is required"),
});

function sendWalletState(res: Response, state: Awaited<ReturnType<typeof getWalletState>>): void {
  setWalletEtagHeader(res.setHeader.bind(res), state.wallet_version);
  res.json(state);
}

/**
 * GET /users/me/wallet
 * Returns wallet balance snapshot and version; sets ETag for optimistic concurrency.
 */
export async function getWallet(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    sendWalletState(res, await getWalletState(userId));
  } catch (e) {
    next(e);
  }
}

/**
 * GET /users/me/balance
 * Returns balance with ETag derived from walletVersion.
 */
export async function getMeBalance(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const { snapshot, walletVersion } = await fetchWalletBalance(userId);
    setWalletEtagHeader(res.setHeader.bind(res), walletVersion);
    res.json({ ...snapshot, wallet_version: walletVersion });
  } catch (e) {
    next(e);
  }
}

/**
 * PUT /users/me/wallet
 * Requires If-Match with the current wallet ETag.
 */
export async function putWalletAddress(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const schema = z.object({
      stellar_address: z.string().length(56).regex(/^G/, "Must be a valid Stellar public key"),
    });
    const body = schema.parse(req.body);

    const previous = await prisma.user.findUnique({
      where: { id: userId },
      select: { stellarAddress: true, walletVersion: true },
    });

    if (previous?.stellarAddress === body.stellar_address) {
      setWalletEtagHeader(res.setHeader.bind(res), previous.walletVersion);
      res.status(200).json({
        ok: true,
        stellar_address: body.stellar_address,
        changed: false,
        wallet_version: previous.walletVersion,
      });
      return;
    }

    const walletVersion = await updateWalletWithConcurrency(userId, getIfMatchHeader(req), {
      stellarAddress: body.stellar_address,
      encryptedStellarSecret: null,
      keyEncryptionHint: "external",
    });

    logger.info("User wallet replaced", {
      userId,
      previousStellarAddress: previous?.stellarAddress ?? null,
      newStellarAddress: body.stellar_address,
      walletVersion,
    });

    setWalletEtagHeader(res.setHeader.bind(res), walletVersion);
    res.status(200).json({
      ok: true,
      stellar_address: body.stellar_address,
      changed: true,
      previous_stellar_address: previous?.stellarAddress ?? null,
      wallet_version: walletVersion,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * DELETE /users/me/wallet
 * Requires If-Match with the current wallet ETag.
 */
export async function deleteWallet(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const previous = await prisma.user.findUnique({
      where: { id: userId },
      select: { stellarAddress: true },
    });

    const walletVersion = await updateWalletWithConcurrency(userId, getIfMatchHeader(req), {
      stellarAddress: null,
      encryptedStellarSecret: null,
      keyEncryptionHint: null,
    });

    logger.info("User wallet detached", {
      userId,
      previousStellarAddress: previous?.stellarAddress ?? null,
      walletVersion,
    });

    setWalletEtagHeader(res.setHeader.bind(res), walletVersion);
    res.status(200).json({
      ok: true,
      previous_stellar_address: previous?.stellarAddress ?? null,
      wallet_version: walletVersion,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /users/me/wallet/confirm
 * Requires If-Match with the current wallet ETag.
 */
export async function postWalletConfirm(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);
    const body = walletConfirmSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        stellarAddress: true,
        encryptedStellarSecret: true,
        passcodeHash: true,
        walletVersion: true,
      },
    });
    if (!user) throw new AppError("User not found", 404);
    if (user.encryptedStellarSecret != null) throw new AppError("Wallet already confirmed", 400);
    if (!user.stellarAddress) throw new AppError("No wallet to confirm", 400);
    try {
      const kp = Keypair.fromSecret(body.passphrase);
      if (kp.publicKey() !== user.stellarAddress)
        throw new AppError("Passphrase does not match wallet", 400);
    } catch {
      throw new AppError("Invalid passphrase", 400);
    }
    if (body.encryption_method !== "passcode" || !user.passcodeHash)
      throw new AppError("Passcode encryption requires a passcode", 400);
    const passcodeMatch = await bcrypt.compare(body.passcode, user.passcodeHash);
    if (!passcodeMatch) throw new AppError("Invalid passcode", 401);

    const salt = WALLET_ENC_SALT_PREFIX + userId;
    const key = crypto.scryptSync(body.passcode, salt, WALLET_ENC_KEYLEN);
    const iv = crypto.randomBytes(WALLET_ENC_IVLEN);
    const cipher = crypto.createCipheriv(WALLET_ENC_ALGO, key, iv);
    const enc = Buffer.concat([cipher.update(body.passphrase, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const blob = Buffer.concat([iv, enc, authTag]);
    const encryptedStellarSecret = blob.toString("base64");

    const walletVersion = await updateWalletWithConcurrency(userId, getIfMatchHeader(req), {
      encryptedStellarSecret,
      keyEncryptionHint: "passcode",
    });

    setWalletEtagHeader(res.setHeader.bind(res), walletVersion);
    res.status(200).json({ ok: true, wallet_version: walletVersion });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return next(new AppError(msg, 400));
    }
    next(e);
  }
}

/**
 * POST /users/me/wallet/activate
 * Requires If-Match with the current wallet ETag.
 */
export async function postWalletActivate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.apiKey?.userId;
    if (!userId) throw new AppError("User-scoped API key required", 401);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { stellarAddress: true, walletVersion: true },
    });
    if (!user?.stellarAddress) throw new AppError("No wallet address set", 400);

    const walletVersion = await updateWalletWithConcurrency(userId, getIfMatchHeader(req), {});

    const result = await ensureAccountActivated(user.stellarAddress);
    setWalletEtagHeader(res.setHeader.bind(res), walletVersion);
    res.status(200).json({
      ok: true,
      stellar_address: user.stellarAddress,
      wallet_version: walletVersion,
      ...result,
    });
  } catch (e) {
    next(e);
  }
}
