/**
 * Fintech provider abstraction. All providers (Flutterwave, Paystack, MTN MoMo, etc.)
 * implement this interface so ReserveTracker and withdrawal/rebalance can use any provider per currency.
 */

export interface DisburseRecipient {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  /** Optional provider-specific fields (e.g. mobile money subscriber id) */
  [key: string]: unknown;
}

export interface ConvertCurrencyResult {
  amount: number;
  rate: number;
}

export interface DisburseResult {
  transactionId: string;
  status: string;
}

export interface FintechProvider {
  getBalance(currency: string): Promise<number>;
  convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<ConvertCurrencyResult>;
  disburseFunds(
    amount: number,
    currency: string,
    recipient: DisburseRecipient,
  ): Promise<DisburseResult>;
}

export type FintechProviderId = "flutterwave" | "paystack" | "mtn_momo" | "simulated";
