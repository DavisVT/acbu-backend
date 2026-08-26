/**
 * GET /v1/config/assets — Public asset configuration.
 *
 * Returns the authoritative ACBU asset (code + issuer) and Stellar network info
 * used by the backend. The frontend relies on this so it can set up trustlines
 * against the exact same asset the minting contract expects. Keeping this
 * out-of-band (via NEXT_PUBLIC_* env vars) leads to silent mismatches whenever
 * backend and frontend are deployed with different values.
 */
import { Request, Response, NextFunction } from "express";
import { stellarClient } from "../services/stellar/client";
import { getContractAddresses } from "../config/contracts";

export async function getPublicAssetsConfig(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const issuer = process.env.STELLAR_ACBU_ASSET_ISSUER;
    const code = (process.env.STELLAR_ACBU_ASSET_CODE || "ACBU").trim().toUpperCase();

    res.status(200).json({
      acbu: {
        code,
        issuer: issuer ?? null,
      },
      demo_fiat: {
        issuer: issuer ?? null,
      },
      stellar: {
        network_passphrase: stellarClient.getNetworkPassphrase(),
        horizon_url: stellarClient.getHorizonUrl?.() ?? null,
        soroban_rpc_url: stellarClient.getSorobanRpcUrl?.() ?? null,
      },
      contracts: {
        burning: getContractAddresses().burning || null,
      },
    });
  } catch (e) {
    next(e);
  }
}
