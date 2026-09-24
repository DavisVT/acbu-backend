process.env.USDC_ISSUER_TESTNET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
process.env.USDC_ISSUER_MAINNET = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
process.env.JWT_SECRET = "dev-jwt-secret-change-me-min-32-characters-long";
process.env.DATABASE_URL = "postgresql://acbu_user:acbu_pass@localhost:5432/acbu_db";

import { isPlaceholderKey } from "./env";

describe("isPlaceholderKey", () => {
  it("returns true for undefined, null, or empty string", () => {
    expect(isPlaceholderKey(undefined)).toBe(true);
    expect(isPlaceholderKey(null)).toBe(true);
    expect(isPlaceholderKey("")).toBe(true);
    expect(isPlaceholderKey("   ")).toBe(true);
  });

  it("returns true for common placeholder strings", () => {
    expect(isPlaceholderKey("Flutterwave secret key")).toBe(true);
    expect(isPlaceholderKey("Paystack secret key")).toBe(true);
    expect(isPlaceholderKey("MTN MoMo subscription key")).toBe(true);
    expect(isPlaceholderKey("MTN MoMo API user ID")).toBe(true);
    expect(isPlaceholderKey("MTN MoMo API key")).toBe(true);
    expect(isPlaceholderKey("change-me")).toBe(true);
    expect(isPlaceholderKey("change-me-in-production")).toBe(true);
    expect(isPlaceholderKey("your-flutterwave-secret-key")).toBe(true);
    expect(isPlaceholderKey("your-paystack-secret-key")).toBe(true);
  });

  it("returns false for legitimate production API keys", () => {
    expect(isPlaceholderKey("FLWSECK-f89a712bc9d02e48fa-X")).toBe(false);
    expect(isPlaceholderKey("ps_valid_key_9281729381723918237192837")).toBe(false);
    expect(isPlaceholderKey("4b8a21f7c9e0482b1732940a")).toBe(false);
  });
});
