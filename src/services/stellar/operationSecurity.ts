import { Operation } from "@stellar/stellar-sdk";
import { logger } from "../../config/logger";

/**
 * Operations that are explicitly forbidden for the treasury account
 * to prevent catastrophic attacks like account_merge that could drain assets
 */
const FORBIDDEN_TREASURY_OPERATIONS = [
  "accountMerge", // Prevents merging treasury into attacker's account
];

/**
 * Validate that a transaction doesn't contain dangerous operations for the treasury account
 * @param operations - Array of Stellar operations
 * @param accountId - The account ID executing the operations
 * @param treasuryAccountId - The platform's treasury account ID
 * @throws Error if a forbidden operation is detected
 */
export function validateOperationsForTreasuryAccount(
  operations: Operation[],
  accountId: string,
  treasuryAccountId: string,
): void {
  if (accountId !== treasuryAccountId) {
    return;
  }

  for (const operation of operations) {
    const opType = (operation as any).type;

    if (FORBIDDEN_TREASURY_OPERATIONS.includes(opType)) {
      const error = new Error(
        `Operation '${opType}' is forbidden for the treasury account to prevent asset drainage attacks`,
      );
      logger.error("Forbidden treasury operation attempted", {
        operation: opType,
        accountId,
        treasuryAccountId,
      });
      throw error;
    }
  }
}

/**
 * Check if an account is the treasury account
 */
export function isTreasuryAccount(accountId: string, treasuryAccountId: string): boolean {
  return accountId === treasuryAccountId;
}
