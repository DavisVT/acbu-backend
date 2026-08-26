/**
 * Weight Drift Audit Service Tests
 *
 * Test scenarios:
 * 1. Calculate drift report with various weight scenarios
 * 2. Create audit with proper DB persistence
 * 3. Approve/reject pending audits with audit trail
 * 4. List audits with pagination and filtering
 */

import { weightDriftAuditService } from "../src/services/reserve/WeightDriftAuditService";
import { basketService } from "../src/services/basket";
import { reserveTracker } from "../src/services/reserve/ReserveTracker";
import { auditService } from "../src/services/audit";
import { prisma } from "../src/config/database";

jest.mock("../src/services/basket");
jest.mock("../src/services/reserve/ReserveTracker");
jest.mock("../src/services/audit");

jest.mock("../src/config/database", () => {
  type MockModel = { [method: string]: jest.Mock };
  function createMockModel(): MockModel {
    return new Proxy({} as MockModel, {
      get: (t, p) => {
        if (typeof p === "string") {
          if (!(p in t)) t[p] = jest.fn();
          return t[p];
        }
        return undefined;
      },
    });
  }
  const prismaModels: Record<string, MockModel> = {};
  const mockPrisma = new Proxy(
    {
      $transaction: jest.fn(),
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      $use: jest.fn(),
      $on: jest.fn(),
      $extends: jest.fn().mockReturnThis(),
    } as any,
    {
      get: (t, p) => {
        if (p in t) return t[p];
        if (typeof p === "string" && !p.startsWith("$")) {
          if (!(p in prismaModels)) prismaModels[p] = createMockModel();
          return prismaModels[p];
        }
        return undefined;
      },
    },
  );
  return {
    prisma: mockPrisma,
    prismaReplica: mockPrisma,
    connectWithRetry: jest.fn().mockResolvedValue(undefined),
    default: mockPrisma,
  };
});

describe("WeightDriftAuditService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("calculateDriftReport", () => {
    it("should calculate drift for each currency", async () => {
      // Mock basket with policy weights
      (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([
        { currency: "USD", weight: 40 },
        { currency: "NGN", weight: 30 },
        { currency: "KES", weight: 30 },
      ]);

      // Mock actual weights from reserves
      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [
          {
            currency: "USD",
            actualWeight: 42,
            targetWeight: 40,
            reserveAmount: 1000,
            reserveValueUsd: 1000,
            weightDrift: 2,
          },
          {
            currency: "NGN",
            actualWeight: 28,
            targetWeight: 30,
            reserveAmount: 5000,
            reserveValueUsd: 500,
            weightDrift: -2,
          },
          {
            currency: "KES",
            actualWeight: 30,
            targetWeight: 30,
            reserveAmount: 3000,
            reserveValueUsd: 500,
            weightDrift: 0,
          },
        ],
      });

      const report = await weightDriftAuditService.calculateDriftReport();

      expect(report.totalCurrencies).toBe(3);
      expect(report.currenciesExceedingThreshold).toBe(2); // USD and NGN exceed 2%
      expect(report.maxDriftPercent).toBe(2);
      expect(report.entries).toHaveLength(3);

      const usdEntry = report.entries.find((e: { currency: string }) => e.currency === "USD");
      expect(usdEntry?.driftPercent).toBe(2);
      expect(usdEntry?.exceedsThreshold).toBe(true);

      const ngnEntry = report.entries.find((e: { currency: string }) => e.currency === "NGN");
      expect(ngnEntry?.driftPercent).toBe(-2);
      expect(ngnEntry?.exceedsThreshold).toBe(true);
    });

    it("should generate recommendations based on drift", async () => {
      (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([
        { currency: "USD", weight: 50 },
      ]);

      (reserveTracker.getReserveStatus as jest.Mock).mockResolvedValue({
        currencies: [
          {
            currency: "USD",
            actualWeight: 55,
            targetWeight: 50,
            reserveAmount: 1000,
            reserveValueUsd: 1000,
            weightDrift: 5,
          },
        ],
      });

      const report = await weightDriftAuditService.calculateDriftReport();
      const entry = report.entries[0];

      expect(entry.recommendation).toContain("Overweight");
      expect(entry.recommendation).toContain("USD");
      expect(entry.recommendation).toContain("50%");
    });
  });

  describe("createAudit", () => {
    it("should create audit record with pending status", async () => {
      const report = {
        auditId: "",
        auditPeriodStart: new Date("2026-04-20"),
        auditPeriodEnd: new Date("2026-04-27"),
        totalCurrencies: 3,
        currenciesExceedingThreshold: 1,
        maxDriftPercent: 2.5,
        entries: [
          {
            currency: "USD",
            policyWeight: 40,
            actualWeight: 42.5,
            driftPercent: 2.5,
            exceedsThreshold: true,
            recommendation: "Overweight by 2.50%",
          },
        ],
        status: "pending" as const,
      };

      // Mock prisma transaction
      (prisma.$transaction as any).mockImplementation(async (fn: (tx: any) => Promise<any>) => {
        const mockTx = {
          weightDriftAudit: {
            create: jest.fn().mockResolvedValue({
              id: "audit-123",
              ...report,
              createdBy: "admin-1",
              status: "pending",
            }),
          },
          weightDriftCurrency: {
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(mockTx);
      });

      (auditService.logAuditEntry as jest.Mock).mockResolvedValue(undefined);

      const result = await weightDriftAuditService.createAudit(
        report,
        "admin-1",
      );

      expect(result.auditId).toBe("audit-123");
      expect(result.status).toBe("pending");
      expect(auditService.logAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "WEIGHT_DRIFT_AUDIT_CREATED",
          action: "create",
        }),
      );
    });
  });

  describe("approveAudit", () => {
    it("should approve pending audit and log action", async () => {
      const mockAudit = {
        id: "audit-123",
        status: "pending",
        currencies: [],
        approvalNotes: null,
      };

      ((prisma as any).weightDriftAudit.findUniqueOrThrow as jest.Mock).mockResolvedValue(
        mockAudit,
      );

      (prisma.$transaction as any).mockImplementation(async (fn: (tx: any) => Promise<any>) => {
        const mockTx = {
          weightDriftAudit: {
            update: jest.fn().mockResolvedValue({
              ...mockAudit,
              status: "approved",
              approvedBy: "admin-1",
              approvalNotes: "Drift within expected range",
              approvedAt: new Date(),
            }),
          },
        };
        return fn(mockTx);
      });

      (auditService.logAuditEntry as jest.Mock).mockResolvedValue(undefined);

      const result = await weightDriftAuditService.approveAudit(
        "audit-123",
        "admin-1",
        "Drift within expected range",
      );

      expect(result.status).toBe("approved");
      expect(auditService.logAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "WEIGHT_DRIFT_AUDIT_APPROVED",
          action: "approve",
        }),
      );
    });

    it("should reject non-pending audits", async () => {
      const mockAudit = {
        id: "audit-123",
        status: "approved",
        currencies: [],
      };

      ((prisma as any).weightDriftAudit.findUniqueOrThrow as jest.Mock).mockResolvedValue(
        mockAudit,
      );

      await expect(
        weightDriftAuditService.approveAudit(
          "audit-123",
          "admin-1",
          "Already approved",
        ),
      ).rejects.toThrow("Cannot approve audit with status: approved");
    });
  });

  describe("rejectAudit", () => {
    it("should reject pending audit with reason", async () => {
      const mockAudit = {
        id: "audit-123",
        status: "pending",
        currencies: [],
      };

      (prisma.weightDriftAudit.findUniqueOrThrow as jest.Mock).mockResolvedValue(
        mockAudit,
      );

      (prisma.$transaction as any).mockImplementation(async (fn: (tx: any) => Promise<any>) => {
        const mockTx = {
          weightDriftAudit: {
            update: jest.fn().mockResolvedValue({
              ...mockAudit,
              status: "rejected",
              approvalNotes: "Market volatility expected",
            }),
          },
        };
        return fn(mockTx);
      });

      (auditService.logAuditEntry as jest.Mock).mockResolvedValue(undefined);

      const result = await weightDriftAuditService.rejectAudit(
        "audit-123",
        "admin-1",
        "Market volatility expected",
      );

      expect(result.status).toBe("rejected");
      expect(auditService.logAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "WEIGHT_DRIFT_AUDIT_REJECTED",
          action: "reject",
        }),
      );
    });
  });

  describe("listAudits", () => {
    it("should list audits with pagination", async () => {
      const mockAudits = [
        {
          id: "audit-1",
          status: "approved",
          createdAt: new Date(),
          currencies: [],
        },
        {
          id: "audit-2",
          status: "pending",
          createdAt: new Date(),
          currencies: [],
        },
      ];

      ((prisma as any).weightDriftAudit.findMany as jest.Mock).mockResolvedValue(
        mockAudits,
      );
      ((prisma as any).weightDriftAudit.count as jest.Mock).mockResolvedValue(2);

      const result = await weightDriftAuditService.listAudits(
        undefined,
        20,
        0,
      );

      expect(result.audits).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should filter audits by status", async () => {
      const mockAudits = [
        {
          id: "audit-1",
          status: "pending",
          createdAt: new Date(),
          currencies: [],
        },
      ];

      ((prisma as any).weightDriftAudit.findMany as jest.Mock).mockResolvedValue(
        mockAudits,
      );
      ((prisma as any).weightDriftAudit.count as jest.Mock).mockResolvedValue(1);

      const result = await weightDriftAuditService.listAudits("pending", 20, 0);

      expect(result.audits).toHaveLength(1);
      expect(result.total).toBe(1);
      expect((prisma as any).weightDriftAudit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "pending" },
        }),
      );
    });
  });
});
