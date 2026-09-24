import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../config/env";
import { AppError } from "./errorHandler";

/**
 * Guard for admin-only endpoints (e.g. /health/deep, /health/metrics).
 * Requires the `x-admin-key` header to match ADMIN_API_KEY env var.
 * If ADMIN_API_KEY is not configured, the endpoint is blocked entirely.
 */
export function requireAdminApiKey(req: Request, _res: Response, next: NextFunction): void {
  const { adminApiKey } = config;
  if (!adminApiKey) {
    next(new AppError("Admin endpoint not available", 503));
    return;
  }
  const provided = req.headers["x-admin-key"];
  if (!provided || typeof provided !== "string") {
    next(new AppError("Unauthorized", 401));
    return;
  }

  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(adminApiKey, "utf8");

  let isValid = false;
  if (providedBuf.length === expectedBuf.length) {
    try {
      isValid = crypto.timingSafeEqual(providedBuf, expectedBuf);
    } catch {
      isValid = false;
    }
  }

  if (!isValid) {
    next(new AppError("Unauthorized", 401));
    return;
  }
  next();
}
