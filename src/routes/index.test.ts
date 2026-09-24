import { Router } from "express";

jest.mock("../config/env", () => ({
  config: {
    apiVersion: "v1",
    nodeEnv: "test",
  },
}));

jest.mock("../controllers/healthController", () => ({
  deepHealthCheck: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

jest.mock("../middleware/adminAuth", () => ({
  requireAdminApiKey: jest.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

jest.mock("../config/promMetrics", () => ({
  registry: {
    contentType: "text/plain",
    metrics: jest.fn(async () => ""),
  },
}));

const stubRouter = () => Router();

jest.mock("./reserveRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./recipientRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./transferRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./userRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./recoveryRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./authRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./mintRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./burnRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./ratesRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./transactionRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./p2pRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./smeRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./internationalRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./salaryRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./enterpriseRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./savingsRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./lendingRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./gatewayRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./billsRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./onrampRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./retailFundsRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./businessFundsRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./governmentFundsRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./investmentRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./fiatRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./configRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./complianceRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./kycRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./weightDriftAuditRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./reportRoutes", () => ({ __esModule: true, default: stubRouter() }));
jest.mock("./privacy", () => ({ __esModule: true, default: stubRouter() }));

import routes from "./index";

describe("API router mounting", () => {
  it("does not mount webhook routes from the API router", () => {
    const stack = (routes as unknown as { stack: Array<{ regexp?: RegExp }> }).stack;

    const hasWebhookMount = stack.some((layer) => {
      const regexp = layer.regexp?.toString() ?? "";
      return regexp.includes("webhooks");
    });

    expect(hasWebhookMount).toBe(false);
  });
});
