import express, { Express } from "express";
import request from "supertest";
import { computeAddressHash } from "../../src/pii/pgcryptoEncryption";
import { consentPreferenceSchema } from "../../src/validation/schemas";
import privacyRoutes from "../../src/routes/privacy";
import { errorHandler } from "../../src/middleware/errorHandler";
import { prisma } from "../../src/config/database";

import { Keypair } from "@stellar/stellar-sdk";

// Mock Prisma client
jest.mock("../../src/config/database", () => ({
  prisma: {
    privacyConsent: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

// Mock logger to avoid noise during tests
jest.mock("../../src/config/logger", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("CCPA/BIPA Privacy Consent Subsystem", () => {
  const VALID_STELLAR_ADDRESS = Keypair.random().publicKey();
  const INVALID_STELLAR_ADDRESS = "INVALID_ADDRESS_FORMAT_12345";
  let expectedHash: string;

  beforeAll(() => {
    expectedHash = computeAddressHash(VALID_STELLAR_ADDRESS);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("computeAddressHash Utility", () => {
    it("should compute a valid 64-character hex hash for a valid Stellar address", () => {
      const hash = computeAddressHash(VALID_STELLAR_ADDRESS);
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce consistent hashes regardless of surrounding whitespace", () => {
      const hash1 = computeAddressHash(VALID_STELLAR_ADDRESS);
      const hash2 = computeAddressHash(`  ${VALID_STELLAR_ADDRESS}  `);
      expect(hash1).toBe(hash2);
    });

    it("should produce a different hash when an optional salt is provided", () => {
      const hashNoSalt = computeAddressHash(VALID_STELLAR_ADDRESS);
      const hashSalted = computeAddressHash(VALID_STELLAR_ADDRESS, "secret-salt");
      expect(hashSalted).toHaveLength(64);
      expect(hashSalted).not.toBe(hashNoSalt);
    });

    it("should throw an error if address argument is missing or not a string", () => {
      expect(() => computeAddressHash("")).toThrow("Address must be a non-empty string");
      expect(() => computeAddressHash(null as any)).toThrow("Address must be a non-empty string");
    });
  });

  describe("consentPreferenceSchema Zod Validation", () => {
    it("should validate a valid payload with snake_case consent fields", () => {
      const payload = {
        address: VALID_STELLAR_ADDRESS,
        analytics_optout: true,
        marketing_optout: false,
        sale_optout: true,
        biometric_consent: true,
      };

      const result = consentPreferenceSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          address: VALID_STELLAR_ADDRESS,
          analytics_optout: true,
          marketing_optout: false,
          sale_optout: true,
          biometric_consent: true,
        });
      }
    });

    it("should normalize camelCase payload aliases to snake_case fields", () => {
      const payload = {
        address: VALID_STELLAR_ADDRESS,
        analyticsOptout: true,
        marketingOptout: true,
        saleOptout: true,
        biometricConsent: false,
      };

      const result = consentPreferenceSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.analytics_optout).toBe(true);
        expect(result.data.marketing_optout).toBe(true);
        expect(result.data.sale_optout).toBe(true);
        expect(result.data.biometric_consent).toBe(false);
      }
    });

    it("should fail validation if address is not a valid Stellar address", () => {
      const payload = {
        address: INVALID_STELLAR_ADDRESS,
        analytics_optout: true,
      };

      const result = consentPreferenceSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("Privacy Routes API Integration", () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      app.use("/api/privacy", privacyRoutes);
      app.use("/api/v1/privacy", privacyRoutes);
      app.use(errorHandler);
    });

    describe("PUT /api/privacy/consent", () => {
      it("should record consent preferences for a valid Stellar address (200 OK)", async () => {
        const mockDbRecord = {
          id: "123e4567-e89b-12d3-a456-426614174000",
          addressHash: expectedHash,
          analyticsOptout: true,
          marketingOptout: true,
          saleOptout: false,
          biometricConsent: true,
          createdAt: new Date("2026-07-25T10:00:00Z"),
          updatedAt: new Date("2026-07-25T10:00:00Z"),
        };

        (prisma.privacyConsent.upsert as jest.Mock).mockResolvedValue(mockDbRecord);

        const res = await request(app)
          .put("/api/privacy/consent")
          .send({
            address: VALID_STELLAR_ADDRESS,
            analytics_optout: true,
            marketing_optout: true,
            sale_optout: false,
            biometric_consent: true,
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.address_hash).toBe(expectedHash);
        expect(res.body.data.analytics_optout).toBe(true);
        expect(res.body.data.marketing_optout).toBe(true);
        expect(res.body.data.sale_optout).toBe(false);
        expect(res.body.data.biometric_consent).toBe(true);

        expect(prisma.privacyConsent.upsert).toHaveBeenCalledWith({
          where: { addressHash: expectedHash },
          update: expect.objectContaining({
            analyticsOptout: true,
            marketingOptout: true,
            saleOptout: false,
            biometricConsent: true,
          }),
          create: expect.objectContaining({
            addressHash: expectedHash,
            analyticsOptout: true,
            marketingOptout: true,
            saleOptout: false,
            biometricConsent: true,
          }),
        });
      });

      it("should perform idempotent last-write-wins update on subsequent PUT", async () => {
        const mockUpdatedRecord = {
          id: "123e4567-e89b-12d3-a456-426614174000",
          addressHash: expectedHash,
          analyticsOptout: false,
          marketingOptout: false,
          saleOptout: true,
          biometricConsent: false,
          createdAt: new Date("2026-07-25T10:00:00Z"),
          updatedAt: new Date("2026-07-25T11:00:00Z"),
        };

        (prisma.privacyConsent.upsert as jest.Mock).mockResolvedValue(mockUpdatedRecord);

        const res = await request(app)
          .put("/api/v1/privacy/consent")
          .send({
            address: VALID_STELLAR_ADDRESS,
            analytics_optout: false,
            marketing_optout: false,
            sale_optout: true,
            biometric_consent: false,
          });

        expect(res.status).toBe(200);
        expect(res.body.data.sale_optout).toBe(true);
        expect(res.body.data.analytics_optout).toBe(false);
      });

      it("should return 400 Bad Request if address is invalid", async () => {
        const res = await request(app)
          .put("/api/privacy/consent")
          .send({
            address: INVALID_STELLAR_ADDRESS,
            analytics_optout: true,
          });

        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
      });

      it("should pass internal error to error handler on database exception", async () => {
        (prisma.privacyConsent.upsert as jest.Mock).mockRejectedValue(new Error("Database offline"));

        const res = await request(app)
          .put("/api/privacy/consent")
          .send({
            address: VALID_STELLAR_ADDRESS,
            analytics_optout: true,
          });

        expect(res.status).toBe(500);
      });
    });

    describe("GET /api/privacy/consent/:address", () => {
      it("should retrieve consent preferences when queried by valid Stellar address (200 OK)", async () => {
        const mockDbRecord = {
          id: "123e4567-e89b-12d3-a456-426614174000",
          addressHash: expectedHash,
          analyticsOptout: true,
          marketingOptout: false,
          saleOptout: true,
          biometricConsent: true,
          createdAt: new Date("2026-07-25T10:00:00Z"),
          updatedAt: new Date("2026-07-25T10:00:00Z"),
        };

        (prisma.privacyConsent.findUnique as jest.Mock).mockResolvedValue(mockDbRecord);

        const res = await request(app).get(`/api/privacy/consent/${VALID_STELLAR_ADDRESS}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.address_hash).toBe(expectedHash);
        expect(res.body.data.analytics_optout).toBe(true);
        expect(res.body.data.sale_optout).toBe(true);

        expect(prisma.privacyConsent.findUnique).toHaveBeenCalledWith({
          where: { addressHash: expectedHash },
        });
      });

      it("should retrieve consent preferences when queried directly by 64-char address hash (200 OK)", async () => {
        const mockDbRecord = {
          id: "123e4567-e89b-12d3-a456-426614174000",
          addressHash: expectedHash,
          analyticsOptout: false,
          marketingOptout: true,
          saleOptout: false,
          biometricConsent: false,
          createdAt: new Date("2026-07-25T10:00:00Z"),
          updatedAt: new Date("2026-07-25T10:00:00Z"),
        };

        (prisma.privacyConsent.findUnique as jest.Mock).mockResolvedValue(mockDbRecord);

        const res = await request(app).get(`/api/v1/privacy/consent/${expectedHash}`);

        expect(res.status).toBe(200);
        expect(res.body.data.address_hash).toBe(expectedHash);
        expect(res.body.data.marketing_optout).toBe(true);

        expect(prisma.privacyConsent.findUnique).toHaveBeenCalledWith({
          where: { addressHash: expectedHash },
        });
      });

      it("should return 404 Not Found if no consent record exists for address", async () => {
        (prisma.privacyConsent.findUnique as jest.Mock).mockResolvedValue(null);

        const res = await request(app).get(`/api/privacy/consent/${VALID_STELLAR_ADDRESS}`);

        expect(res.status).toBe(404);
        expect(res.body.error).toBeDefined();
      });

      it("should return 400 Bad Request for an invalid address or hash format", async () => {
        const res = await request(app).get(`/api/privacy/consent/${INVALID_STELLAR_ADDRESS}`);

        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
      });
    });
  });
});
