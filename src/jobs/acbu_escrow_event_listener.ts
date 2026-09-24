/**
 * Listens for events on acbu_escrow contract and enqueues ACBU_ESCROW_EVENTS.
 */
import { eventListener, ContractEvent } from "../services/stellar/eventListener";
import { getContractAddresses } from "../config/contracts";
import { logger } from "../config/logger";
import { escrowEventProducer } from "./producers";
import { extractAndValidateTxHash } from "../services/stellar/txHashValidation";

const ESCROW_EFFECT_TYPES = [
  "contract_credited",
  "contract_debited",
  "contract_effect",
] as const;

type EscrowEffectType = (typeof ESCROW_EFFECT_TYPES)[number];

function isEscrowEffectType(type: string): type is EscrowEffectType {
  return (ESCROW_EFFECT_TYPES as readonly string[]).includes(type);
const ESCROW_EFFECT_TYPES = ["contract_credited", "contract_debited", "contract_effect"];

function sanitizeEventData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const { txHash, valid } = extractAndValidateTxHash(data);
  if (txHash === null || !valid) {
    const sanitized = { ...data };
    delete sanitized.transaction_hash;
    delete sanitized.transaction_id;
    delete sanitized.tx_hash;
    return sanitized;
  }
  return data;
}

export async function startEscrowEventListener(): Promise<void> {
  const contractId = getContractAddresses().escrow;
  if (!contractId) {
    logger.info("Escrow event listener skipped: no CONTRACT_ESCROW configured");
    return;
  }

  const handler = async (event: ContractEvent): Promise<void> => {
    try {
      // listenToContractEvents (below) already filters to ESCROW_EFFECT_TYPES
      // before invoking this handler, so this should be unreachable — narrow
      // explicitly anyway rather than casting past the compiler.
      if (!isEscrowEffectType(event.type)) {
        logger.warn("Escrow event with unexpected type reached handler", {
      const rawData = (event.data || {}) as Record<string, unknown>;
      const { txHash, valid } = extractAndValidateTxHash(rawData);

      if (txHash !== null && !valid) {
        logger.warn("Escrow event: rejecting event with unverified tx hash", {
          txHash,
          ledger: event.ledger,
          type: event.type,
        });
        return;
      }

      const sanitizedData = sanitizeEventData(rawData);

      const validatedEvent = {
        contractId: event.contractId,
        type: event.type,
        data: sanitizedData,
        ledger: event.ledger,
        timestamp: new Date(event.timestamp || Date.now()).toISOString(),
      };

      await escrowEventProducer.publish(validatedEvent);

      logger.debug("Escrow event enqueued with validation", {
        type: event.type,
        ledger: event.ledger,
      });
    } catch (error) {
      logger.error("Escrow event enqueue failed", {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.type,
        ledger: event.ledger,
      });
    }
  };

  eventListener.listenToContractEvents(
    contractId,
    [...ESCROW_EFFECT_TYPES],
    handler,
  );
  eventListener.listenToContractEvents(contractId, ESCROW_EFFECT_TYPES, handler);
  logger.info("Escrow event listener registered with validation", {
    contractId,
    effectTypes: ESCROW_EFFECT_TYPES,
  });
}
