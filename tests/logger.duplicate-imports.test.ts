/**
 * Tests for #713 — logger.ts no longer redeclares imported redactFormat / redactPii.
 *
 * Verifies that:
 *  - logger.ts re-exports match the logRedaction.ts canonical implementations (same reference)
 *  - logger loads without duplicate-identifier errors
 *  - redaction still works end-to-end through the logger re-export path
 */
import {
  redactFormat as loggerRedactFormat,
  redactPii as loggerRedactPii,
  redactLogValue as loggerRedactLogValue,
} from "../src/config/logger";
import {
  redactFormat as logRedactionRedactFormat,
  redactPii as logRedactionRedactPii,
  redactLogValue as logRedactionRedactLogValue,
} from "../src/config/logRedaction";
import winston from "winston";
import { Writable } from "stream";

describe("logger.ts re-exports from logRedaction.ts", () => {
  it("redactFormat imported from logger is the same reference as logRedaction", () => {
    expect(loggerRedactFormat).toBe(logRedactionRedactFormat);
  });

  it("redactPii imported from logger is the same reference as logRedaction", () => {
    expect(loggerRedactPii).toBe(logRedactionRedactPii);
  });

  it("redactLogValue imported from logger is the same reference as logRedaction", () => {
    expect(loggerRedactLogValue).toBe(logRedactionRedactLogValue);
  });
});

describe("logger module loads without duplicate-identifier errors", () => {
  it("exports logger and logFinancialEvent from logger.ts", async () => {
    const mod = await import("../src/config/logger");
    expect(mod.logger).toBeDefined();
    expect(typeof mod.logger.info).toBe("function");
    expect(typeof mod.logFinancialEvent).toBe("function");
  });

  it("re-exported redactFormat is callable and returns a winston format", () => {
    const format = loggerRedactFormat();
    expect(format).toBeDefined();
    expect(typeof format.transform).toBe("function");
  });
});

describe("redaction works through logger re-export path", () => {
  it("redactFormat from logger redacts sensitive meta in winston transport", (done) => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    const testLogger = winston.createLogger({
      level: "debug",
      format: winston.format.combine(
        loggerRedactFormat(),
        winston.format.json(),
      ),
      transports: [new winston.transports.Stream({ stream })],
    });

    testLogger.debug("test message", {
      apiKey: "sk-secret-12345",
      passcode: "9999",
      safe: "not-redacted",
    });

    setImmediate(() => {
      expect(chunks).toHaveLength(1);
      const parsed = JSON.parse(chunks[0]);
      expect(parsed.apiKey).toBe("[REDACTED]");
      expect(parsed.passcode).toBe("[REDACTED]");
      expect(parsed.safe).toBe("not-redacted");
      done();
    });
  });

  it("redactPii from logger masks card-like numbers", () => {
    const input = "charge to card 4111111111111111 succeeded";
    const result = loggerRedactPii(input);
    expect(result).toBe("charge to card [REDACTED] succeeded");
    expect(result).not.toContain("4111111111111111");
  });

  it("redactLogValue from logger recursively redacts sensitive keys", () => {
    const input = {
      user: "alice",
      nested: { token: "bearer-xyz", password: "hunter2" },
    };
    const result = loggerRedactLogValue(input);
    expect(result).toEqual({
      user: "alice",
      nested: { token: "[REDACTED]", password: "[REDACTED]" },
    });
  });

  it("negative: redactLogValue does NOT redact non-sensitive keys", () => {
    const input = { amount: 100, currency: "NGN", message: "hello" };
    const result = loggerRedactLogValue(input);
    expect(result).toEqual(input);
  });
});
