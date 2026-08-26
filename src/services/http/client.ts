/**
 * Shared axios factory with a Retry-After-aware retry interceptor.
 *
 * Retryable conditions:
 *   - 429 Too Many Requests  → always honour Retry-After
 *   - 503 Service Unavailable → honour Retry-After when present, else backoff
 *   - Other 5xx              → exponential backoff, no Retry-After expected
 *   - Network errors (no response)
 *
 * Retry-After header is parsed as both a delay-in-seconds integer and as an
 * HTTP-date (RFC 7231 §7.1.3).  Capped at MAX_RETRY_AFTER_MS to avoid
 * sleeping forever on a misconfigured header.
 */
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
  AxiosError,
} from "axios";
import { logger } from "../../config/logger";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_RETRY_AFTER_MS = 60_000; // never wait more than 60 s

/** Parse Retry-After header → milliseconds to wait (0 if unparseable). */
function parseRetryAfterMs(header: string | undefined): number {
  if (!header) return 0;
  const secs = Number(header);
  if (!Number.isNaN(secs)) return Math.min(secs * 1_000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
  return 0;
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 503 || (status >= 500 && status < 600);
}

function backoffMs(attempt: number): number {
  // 1 s, 2 s, 4 s …
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_RETRY_AFTER_MS);
}

/** Attach retry-with-Retry-After interceptor to an existing AxiosInstance. */
export function attachRetryInterceptor(instance: AxiosInstance): void {
  instance.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as InternalAxiosRequestConfig & { _retryCount?: number };
    if (!config) return Promise.reject(error);

    const status = error.response?.status ?? 0;
    const hasResponse = !!error.response;

    // Don't retry non-retryable 4xx (except 429) or if we have no error.config
    if (hasResponse && !isRetryable(status)) return Promise.reject(error);

    config._retryCount = (config._retryCount ?? 0) + 1;
    if (config._retryCount > MAX_RETRIES) return Promise.reject(error);

    const retryAfterHeader = error.response?.headers?.["retry-after"] as string | undefined;
    const waitMs = retryAfterHeader
      ? parseRetryAfterMs(retryAfterHeader)
      : backoffMs(config._retryCount);

    logger.warn("HTTP retry scheduled", {
      url: config.url,
      status: status || "network_error",
      attempt: config._retryCount,
      waitMs,
    });

    await new Promise((r) => setTimeout(r, waitMs));
    return instance.request(config);
  });
}

/**
 * Create an axios instance pre-configured with the Retry-After-aware interceptor.
 * All fintech clients should use this instead of `axios.create()` directly.
 */
export function createHttpClient(options?: AxiosRequestConfig): AxiosInstance {
  const instance = axios.create({ timeout: 5_000, ...options });
  attachRetryInterceptor(instance);
  return instance;
}
