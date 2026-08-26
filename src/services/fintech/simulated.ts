import { prisma } from "../../config/database";
import { logger } from "../../config/logger";
import type {
  FintechProvider,
  DisburseRecipient,
  ConvertCurrencyResult,
  DisburseResult,
} from "./types";

/**
 * Simulated Fintech Provider shim (no simulated bank DB; custodial Soroban is source of truth).
 */
export class SimulatedFintechProvider implements FintechProvider {
  /**
   * Get balance for a specific currency by summing all simulated bank accounts for that currency
   */
  async getBalance(_currency: string): Promise<number> {
    // Simulated bank removed (custodial Soroban MVP); no aggregate DB balance.
    return 0;
  }

  /**
   * Conversion is handled by the Oracle, but this provides a shim using the latest Oracle rates
   */
  async convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<ConvertCurrencyResult> {
    try {
      const fromRateRow = await prisma.oracleRate.findFirst({
        where: { currency: fromCurrency },
        orderBy: { timestamp: "desc" },
      });
      const toRateRow = await prisma.oracleRate.findFirst({
        where: { currency: toCurrency },
        orderBy: { timestamp: "desc" },
      });

      const fromRate = fromRateRow?.rateUsd.toNumber();
      const toRate = toRateRow?.rateUsd.toNumber();

      if (!fromRate || !toRate) {
        throw new Error(`Missing rates for conversion: ${fromCurrency} or ${toCurrency}`);
      }

      // amount * (USD/from) / (USD/to) = amount * (to/from)
      const rate = fromRate / toRate;
      const resultAmount = amount * rate;

      return {
        amount: resultAmount,
        rate: rate,
      };
    } catch (error: any) {
      logger.error("Simulated conversion failed", {
        amount,
        fromCurrency,
        toCurrency,
        error: error?.message || error,
      });
      throw error;
    }
  }

  /**
   * Disbursement in simulation just moves money from a system bank account
   * (or just logs the intent for MVP)
   */
  async disburseFunds(
    amount: number,
    currency: string,
    recipient: DisburseRecipient,
  ): Promise<DisburseResult> {
    logger.info("Simulated disbursement (simulated fiat system)", {
      amount,
      currency,
      recipient,
    });

    // In a full simulation, we might want to find a "system" bank account
    // and deduct funds, then record it in the ledger.
    // For now, we'll just return a success result.

    return {
      transactionId: `sim_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      status: "completed",
    };
  }
}

export const simulatedFintechProvider = new SimulatedFintechProvider();
