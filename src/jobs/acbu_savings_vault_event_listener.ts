/**
 * Listens for events on acbu_savings_vault contract and enqueues ACBU_SAVINGS_VAULT_EVENTS.
 */
import {
  eventListener,
  ContractEvent,
} from "../services/stellar/eventListener";
import { getContractAddresses } from "../config/contracts";
import { logger } from "../config/logger";
import { savingsVaultEventProducer } from "./producers";

const SAVINGS_VAULT_EFFECT_TYPES = [
  "contract_credited",
  "contract_debited",
  "contract_effect",
] as const;

type SavingsVaultEffectType = (typeof SAVINGS_VAULT_EFFECT_TYPES)[number];

function isSavingsVaultEffectType(type: string): type is SavingsVaultEffectType {
  return (SAVINGS_VAULT_EFFECT_TYPES as readonly string[]).includes(type);
}

export async function startSavingsVaultEventListener(): Promise<void> {
  const contractId = getContractAddresses().savingsVault;
  if (!contractId) {
    logger.info(
      "Savings vault event listener skipped: no CONTRACT_SAVINGS_VAULT configured",
    );
    return;
  }

  const handler = async (event: ContractEvent): Promise<void> => {
    try {
      // listenToContractEvents (below) already filters to SAVINGS_VAULT_EFFECT_TYPES
      // before invoking this handler, so this should be unreachable — narrow
      // explicitly anyway rather than casting past the compiler.
      if (!isSavingsVaultEffectType(event.type)) {
        logger.warn("Savings vault event with unexpected type reached handler", {
          type: event.type,
        });
        return;
      }

      const validatedEvent = {
        contractId: event.contractId,
        type: event.type,
        data: event.data || {},
        ledger: event.ledger,
        timestamp: new Date(event.timestamp || Date.now()).toISOString(),
      };

      await savingsVaultEventProducer.publish(validatedEvent);

      logger.debug("Savings vault event enqueued with validation", {
        type: event.type,
        ledger: event.ledger,
      });
    } catch (error) {
      logger.error("Savings vault event enqueue failed", {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.type,
        ledger: event.ledger,
      });
    }
  };

  eventListener.listenToContractEvents(
    contractId,
    [...SAVINGS_VAULT_EFFECT_TYPES],
    handler,
  );
  logger.info("Savings vault event listener registered with validation", {
    contractId,
    effectTypes: SAVINGS_VAULT_EFFECT_TYPES,
  });
}