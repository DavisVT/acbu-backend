/**
 * Listens for MintEvent (contract_credited) on acbu_minting contract and enqueues USDC_CONVERSION jobs.
 */
import { eventListener, ContractEvent } from "../services/stellar/eventListener";
import { getContractAddresses } from "../config/contracts";
import { enqueueUsdcConversion } from "./usdcConversionJob";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import {
  resolveTxHash,
  verifyTxHashOnChain,
} from "../services/stellar/txHashValidation";

const MINT_EFFECT_TYPES = ["contract_credited", "contract_effect"]; // Horizon effect types for mint/credit

function parseAmountFromEffect(data: Record<string, unknown>): string | null {
  const amount = data.amount ?? data.value;
  if (typeof amount === "string") return amount;
  if (typeof amount === "number") return String(amount);
  return null;
}

function parseRecipientFromEffect(data: Record<string, unknown>): string | null {
  const account = data.account ?? data.recipient ?? data.to;
  if (typeof account === "string" && account.length === 56) return account;
  return null;
}

/**
 * Find a pending mint Transaction by blockchain tx hash (set by API after invoke).
 */
async function findTransactionByBlockchainHash(txHash: string): Promise<string | null> {
  const tx = await prisma.transaction.findFirst({
    where: {
      type: "mint",
      blockchainTxHash: txHash,
      status: { in: ["pending", "processing"] },
    },
    select: { id: true },
  });
  return tx?.id ?? null;
}

export async function startMintEventListener(): Promise<void> {
  const mintingContractId = getContractAddresses().minting;
  if (!mintingContractId) {
    logger.info("Mint event listener skipped: no CONTRACT_MINTING configured");
    return;
  }

  const handler = async (event: ContractEvent): Promise<void> => {
    const data = (event.data || {}) as Record<string, unknown>;
    const amountStr = parseAmountFromEffect(data);
    const recipient = parseRecipientFromEffect(data);
    if (!amountStr || !recipient) {
      logger.debug("Mint event skipped: missing amount or recipient", {
        type: event.type,
        hasAmount: !!amountStr,
        hasRecipient: !!recipient,
      });
      return;
    }
    const amountNum = parseFloat(amountStr);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      logger.debug("Mint event skipped: invalid amount", { amountStr });
      return;
    }

    const rawTxHash =
      parseTxHashFromEffect(data) ?? (event.data as Record<string, unknown> | undefined)?.id;
    const txHash: string =
      typeof rawTxHash === "string" ? rawTxHash : `effect-${event.ledger}-${Date.now()}`;
    let transactionId: string | null = null;
    if (txHash.length === 64) {
      transactionId = await findTransactionByBlockchainHash(txHash);
    }
    if (!verified) {
      logger.warn("Mint event: rejecting event with unverified tx hash", {
        txHash: resolvedHash,
        ledger: event.ledger,
      });
      return;
    }

    const onChainValid = await verifyTxHashOnChain(resolvedHash);
    if (!onChainValid) {
      logger.warn("Mint event: rejecting event — tx hash not found on-chain", {
        txHash: resolvedHash,
        ledger: event.ledger,
      });
      return;
    }

    let transactionId: string | null = null;
    transactionId = await findTransactionByBlockchainHash(resolvedHash);

    await enqueueUsdcConversion({
      usdcAmount: amountStr,
      recipient,
      txHash: resolvedHash,
      transactionId: transactionId ?? undefined,
    });
  };

  eventListener.listenToContractEvents(mintingContractId, MINT_EFFECT_TYPES, handler);
  logger.info("Mint event listener registered", {
    contractId: mintingContractId,
    effectTypes: MINT_EFFECT_TYPES,
  });
}
