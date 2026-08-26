import type { InvestmentWithdrawalRequest } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { isBusinessWithdrawalAllowedDay } from "../../config/investment";
import {
  assertSafeSqlTimeZone,
  getDefaultBusinessTimeZone,
  resolveTimeZone,
} from "../../utils/dateUtils";

const WITHDRAWAL_DELAY_HOURS = 24;
const READY_WITHDRAWAL_BATCH_SIZE = 100;
export const READY_WITHDRAWAL_STATUSES = ["requested", "processing"] as const;

type WithdrawalTimingRow = {
  requestedAt: Date;
  availableAt: Date;
  businessCalendarDay: number;
};

type TrustedClockRow = {
  trustedNow: Date;
};

export type InvestmentWithdrawalTiming = {
  requestedAt: Date;
  availableAt: Date;
  businessCalendarDay: number;
  isBusinessWithdrawalAllowedDate: boolean;
};

export type ReadyInvestmentWithdrawalBatch = {
  trustedNow: Date;
  records: InvestmentWithdrawalRequest[];
};

/**
 * Reads PostgreSQL's wall clock once and derives every withdrawal timing value
 * from that trusted source. This keeps delay enforcement independent from API
 * server clock drift.
 */
export async function getInvestmentWithdrawalTiming(
  timeZone?: string,
): Promise<InvestmentWithdrawalTiming> {
  const businessTimeZone = assertSafeSqlTimeZone(
    resolveTimeZone(timeZone ?? getDefaultBusinessTimeZone()),
  );

  const [row] = await prisma.$queryRaw<WithdrawalTimingRow[]>(
    Prisma.sql`
      WITH trusted_clock AS (
        SELECT clock_timestamp() AS trusted_now
      )
      SELECT
        trusted_now AS "requestedAt",
        trusted_now + ${Prisma.sql`make_interval(hours => ${WITHDRAWAL_DELAY_HOURS})`} AS "availableAt",
        EXTRACT(DAY FROM (trusted_now AT TIME ZONE ${businessTimeZone}))::int AS "businessCalendarDay"
      FROM trusted_clock
    `,
  );

  const requestedAt = assertDate(row?.requestedAt, "requestedAt");
  const availableAt = assertDate(row?.availableAt, "availableAt");
  const businessCalendarDay = assertBusinessCalendarDay(row?.businessCalendarDay);

  return {
    requestedAt,
    availableAt,
    businessCalendarDay,
    isBusinessWithdrawalAllowedDate: isBusinessWithdrawalAllowedDay(businessCalendarDay),
  };
}

export async function getReadyInvestmentWithdrawalBatch(
  limit = READY_WITHDRAWAL_BATCH_SIZE,
): Promise<ReadyInvestmentWithdrawalBatch> {
  const trustedNow = await getTrustedDatabaseTime();
  const records = await prisma.investmentWithdrawalRequest.findMany({
    where: {
      status: { in: [...READY_WITHDRAWAL_STATUSES] },
      availableAt: { lte: trustedNow },
    },
    take: limit,
  });

  return { trustedNow, records };
}

async function getTrustedDatabaseTime(): Promise<Date> {
  const [row] = await prisma.$queryRaw<TrustedClockRow[]>(
    Prisma.sql`SELECT clock_timestamp() AS "trustedNow"`,
  );

  return assertDate(row?.trustedNow, "trustedNow");
}

function assertDate(value: unknown, fieldName: string): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  throw new Error(`Database clock query returned invalid ${fieldName}`);
}

function assertBusinessCalendarDay(value: unknown): number {
  const day = Number(value);
  if (Number.isInteger(day) && day >= 1 && day <= 31) {
    return day;
  }

  throw new Error("Database clock query returned invalid businessCalendarDay");
}
