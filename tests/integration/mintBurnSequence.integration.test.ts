import { Decimal } from "@prisma/client/runtime/library";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../../src/middleware/auth";
import { burnAcbu } from "../../src/controllers/burnController";
import { mintFromUsdcInternal } from "../../src/controllers/mintController";
import { prisma } from "../../src/config/database";
import { acbuBurningService, acbuMintingService } from "../../src/services/contracts";
import { stellarClient } from "../../src/services/stellar/client";
import { checkWithdrawalLimits, isCurrencyWithdrawalPaused } from "../../src/services/limits/limitsService";
import { getBurnFeeBps } from "../../src/services/feePolicy/feePolicyService";
import { assertUserWalletAddress } from "../../src/services/wallet/walletService";
import { logAudit } from "../../src/services/audit";

jest.mock("../../src/config/database", () => ({
  prisma: {
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    acbuRate: {
      findFirst: jest.fn(),
    },
  },
}));

jest.mock("../../src/config/contracts", () => ({
  getContractAddresses: () => ({
    oracle: "",
    reserveTracker: "",
    minting: "minting-contract-id",
    burning: "burning-contract-id",
    savingsVault: "",
    lendingPool: "",
    escrow: "",
  }),
  contractAddresses: {
    oracle: "",
    reserveTracker: "",
    minting: "minting-contract-id",
    burning: "burning-contract-id",
    savingsVault: "",
    lendingPool: "",
    escrow: "",
  },
}));

jest.mock("../../src/services/contracts", () => ({
  acbuMintingService: {
    mintFromUsdc: jest.fn(),
  },
  acbuBurningService: {
    redeemSingle: jest.fn(),
  },
}));

jest.mock("../../src/services/stellar/client", () => ({
  stellarClient: {
    getKeypair: jest.fn(),
  },
}));

jest.mock("../../src/services/limits/limitsService", () => ({
  checkWithdrawalLimits: jest.fn(),
  isCurrencyWithdrawalPaused: jest.fn(),
  checkDepositLimits: jest.fn(),
  isMintingPaused: jest.fn(),
}));

jest.mock("../../src/services/feePolicy/feePolicyService", () => ({
  getBurnFeeBps: jest.fn(),
}));

jest.mock("../../src/services/wallet/walletService", () => ({
  assertUserWalletAddress: jest.fn(),
}));

jest.mock("../../src/services/audit", () => ({
  logAudit: jest.fn(),
}));

const prismaMock = prisma as unknown as {
  transaction: {
    create: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
  };
  acbuRate: {
    findFirst: jest.Mock;
  };
};

const mintMock = acbuMintingService.mintFromUsdc as jest.Mock;
const burnMock = acbuBurningService.redeemSingle as jest.Mock;
const stellarKeypairMock = stellarClient.getKeypair as jest.Mock;
const withdrawalPausedMock = isCurrencyWithdrawalPaused as jest.Mock;
const withdrawalLimitsMock = checkWithdrawalLimits as jest.Mock;
const burnFeeBpsMock = getBurnFeeBps as jest.Mock;
const assertWalletMock = assertUserWalletAddress as jest.Mock;
const logAuditMock = logAudit as jest.Mock;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

describe("B-444 simultaneous mint and burn", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const sourceAccount = "G" + "A".repeat(55);
    stellarKeypairMock.mockReturnValue({
      publicKey: () => sourceAccount,
    });

    assertWalletMock.mockResolvedValue(sourceAccount);
    withdrawalPausedMock.mockResolvedValue(false);
    withdrawalLimitsMock.mockResolvedValue(undefined);
    burnFeeBpsMock.mockResolvedValue(50);
    logAuditMock.mockResolvedValue(undefined);

    prismaMock.transaction.create.mockImplementation(async ({ data }) => ({
      id: data.type === "mint" ? "mint-tx-1" : "burn-tx-1",
      ...data,
      createdAt: new Date("2026-05-28T00:00:00.000Z"),
    }));
    prismaMock.transaction.update.mockResolvedValue({});
    prismaMock.transaction.findFirst.mockResolvedValue(null);
    prismaMock.acbuRate.findFirst.mockResolvedValue({
      timestamp: new Date("2026-05-28T00:00:00.000Z"),
      acbuNgn: new Decimal("500"),
    });

    mintMock.mockImplementation(async (params: { user: string }) => {
      await delay(25);
      return {
        transactionHash: "mint-contract-hash",
        acbuAmount: "1000000",
        user: params.user,
      };
    });

    burnMock.mockImplementation(async (params: { user: string }) => {
      await delay(5);
      return {
        transactionHash: "burn-contract-hash",
        localAmount: "5000",
        user: params.user,
      };
    });
  });

  it("keeps mint and burn on the same source account stable when issued back-to-back", async () => {
    const sourceAccount = "G" + "A".repeat(55);
    const burnReq = {
      body: {
        acbu_amount: "10",
        currency: "NGN",
        recipient_account: {
          type: "bank",
          account_number: "1234567890",
          bank_code: "001",
          account_name: "Test Account",
        },
      },
      apiKey: { userId: "user-1", organizationId: null },
      audience: "retail",
    } as unknown as AuthRequest;

    const burnRes = makeRes();
    const burnNext = makeNext();

    const mintPromise = mintFromUsdcInternal(
      10,
      sourceAccount,
      "user-1",
      undefined,
    );
    const burnPromise = burnAcbu(burnReq, burnRes, burnNext);

    const [mintResult] = await Promise.all([mintPromise, burnPromise]);

    expect(mintMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: sourceAccount,
        recipient: sourceAccount,
      }),
    );
    expect(burnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: sourceAccount,
        recipient: sourceAccount,
      }),
    );
    expect(prismaMock.transaction.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.transaction.update).toHaveBeenCalledTimes(2);
    expect(mintResult).toEqual({
      transactionId: "mint-tx-1",
      acbuAmount: "0.1",
    });
    expect(burnRes.status).toHaveBeenCalledWith(200);
    expect(burnRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        transaction_id: "burn-tx-1",
        blockchain_tx_hash: "burn-contract-hash",
      }),
    );
    expect(burnNext).not.toHaveBeenCalled();
  });
});
