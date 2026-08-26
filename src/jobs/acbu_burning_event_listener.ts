/**
 * Listens for BurnEvent (contract_debited) on acbu_burning contract and enqueues WITHDRAWAL_PROCESSING jobs.
 */
import { eventListener, ContractEvent } from "../services/stellar/eventListener";
import { getContractAddresses } from "../config/contracts";
import { enqueueWithdrawalProcessing } from "./withdrawalProcessingJob";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import {
  resolveTxHash,
  verifyTxHashOnChain,
} from "../services/stellar/txHashValidation";

const BURN_EFFECT_TYPES = ["contract_debited", "contract_effect"];

function parseTxHashFromEffect(data: Record<string, unknown>): string | null {
  const txHash = data.transaction_hash ?? data.transaction_id ?? data.tx_hash;
  if (typeof txHash === "string") return txHash;
  const links = data._links as Record<string, { href?: string }> | undefined;
  const txHref = links?.transaction?.href;
  if (typeof txHref === "string") {
    const match = txHref.match(/\/([a-f0-9]+)$/i);
    if (match) return match[1];
  }
  return null;
}

async function findTransactionByBlockchainHash(txHash: string): Promise<string | null> {
  const tx = await prisma.transaction.findFirst({
    where: {
      type: "burn",
      blockchainTxHash: txHash,
      status: { in: ["pending", "processing"] },
    },
    select: { id: true },
  });
  return tx?.id ?? null;
}

export async function startBurnEventListener(): Promise<void> {
  const burningContractId = getContractAddresses().burning;
  if (!burningContractId) {
    logger.info("Burn event listener skipped: no CONTRACT_BURNING configured");
    return;
  }

  const handler = async (event: ContractEvent): Promise<void> => {
    const data = (event.data || {}) as Record<string, unknown>;
    const rawTxHash =
      parseTxHashFromEffect(data) ?? (event.data as Record<string, unknown> | undefined)?.id;
    const txHash: string =
      typeof rawTxHash === "string" ? rawTxHash : `effect-${event.ledger}-${Date.now()}`;
    if (txHash.length !== 64) {
      logger.debug("Burn event: no blockchain tx hash, skipping enqueue", {
        txHash,
      });
      return;
    }

    const transactionId = await findTransactionByBlockchainHash(resolvedHash);
    if (!transactionId) {
      logger.debug("Burn event: no pending/processing burn transaction for hash", { txHash });
      return;
    }
    await enqueueWithdrawalProcessing({ transactionId, txHash: resolvedHash });
  };

  eventListener.listenToContractEvents(burningContractId, BURN_EFFECT_TYPES, handler);
  logger.info("Burn event listener registered", {
    contractId: burningContractId,
    effectTypes: BURN_EFFECT_TYPES,
  });
}
