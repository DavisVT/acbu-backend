import { validateOperationsForTreasuryAccount, isTreasuryAccount } from "./operationSecurity";

describe("operationSecurity", () => {
  const treasuryAccountId = "GDZST3XVCDTUJ76ZAV2HA72KYLT5FGZD5G6N7NZ6XHFWLQDN5SWTB24F";
  const otherAccountId = "GBXDIBFH4ZRXO3KSQXQJIBQQFQULWIKFKFH4DBGFWJDX6GWVDGXC5X3";

  describe("validateOperationsForTreasuryAccount", () => {
    it("should allow safe operations for treasury account", () => {
      const operations: any[] = [
        { type: "payment", destination: otherAccountId, amount: "100" },
        { type: "createAccount", destination: otherAccountId, startingBalance: "10" },
      ];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
      ).not.toThrow();
    });

    it("should reject accountMerge operations for treasury account", () => {
      const operations: any[] = [{ type: "accountMerge", destination: otherAccountId }];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
      ).toThrow(
        "Operation 'accountMerge' is forbidden for the treasury account to prevent asset drainage attacks",
      );
    });

    it("should allow all operations for non-treasury accounts", () => {
      const operations: any[] = [{ type: "accountMerge", destination: treasuryAccountId }];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, otherAccountId, treasuryAccountId),
      ).not.toThrow();
    });

    it("should allow operations when no treasury account is configured", () => {
      const operations: any[] = [{ type: "accountMerge", destination: otherAccountId }];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, treasuryAccountId, ""),
      ).not.toThrow();
    });
  });

  describe("isTreasuryAccount", () => {
    it("should identify treasury account correctly", () => {
      expect(isTreasuryAccount(treasuryAccountId, treasuryAccountId)).toBe(true);
    });

    it("should identify non-treasury account correctly", () => {
      expect(isTreasuryAccount(otherAccountId, treasuryAccountId)).toBe(false);
    });
  });
});
