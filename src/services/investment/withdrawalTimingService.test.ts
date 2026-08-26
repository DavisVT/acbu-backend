import { prisma } from "../../config/database";
import { getInvestmentWithdrawalTiming } from "./withdrawalTimingService";

jest.mock("../../config/database", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    investmentWithdrawalRequest: {
      findMany: jest.fn(),
    },
  },
}));

const mockQueryRaw = prisma.$queryRaw as jest.Mock;

describe("getInvestmentWithdrawalTiming", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("maps withdrawal timing from the trusted database clock row", async () => {
    const requestedAt = new Date("2026-05-15T09:30:00.000Z");
    const availableAt = new Date("2026-05-16T09:30:00.000Z");
    mockQueryRaw.mockResolvedValue([
      {
        requestedAt,
        availableAt,
        businessCalendarDay: 15,
      },
    ]);

    await expect(getInvestmentWithdrawalTiming()).resolves.toEqual({
      requestedAt,
      availableAt,
      businessCalendarDay: 15,
      isBusinessWithdrawalAllowedDate: true,
    });
  });

  it("passes timezone as a parameterized SQL value rather than raw string interpolation", async () => {
    const requestedAt = new Date("2026-05-15T09:30:00.000Z");
    const availableAt = new Date("2026-05-16T09:30:00.000Z");
    mockQueryRaw.mockResolvedValue([
      {
        requestedAt,
        availableAt,
        businessCalendarDay: 15,
      },
    ]);

    await getInvestmentWithdrawalTiming("Africa/Lagos");

    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    const sqlQuery = mockQueryRaw.mock.calls[0][0];
    expect(sqlQuery.values).toContain("Africa/Lagos");
    expect(sqlQuery.strings.join("")).not.toContain("'Africa/Lagos'");
  });
});
