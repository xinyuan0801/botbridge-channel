import { setTimeout as sleep } from "node:timers/promises";
import { CHANNEL_ID } from "../constants.js";
import type { BotBridgeConfig } from "../config.js";
import type { PluginLogger } from "../openclaw-types.js";
import type { OutboundCallbackPayload } from "../types.js";

export type OutboundAttemptResult =
  | {
      ok: true;
      attempts: number;
      statusCode: number;
    }
  | {
      ok: false;
      attempts: number;
      error: string;
      statusCode?: number;
      retryable?: boolean;
    };

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

function computeBackoffMs(baseDelayMs: number, attempt: number): number {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.random() * Math.max(25, baseDelayMs * 0.2);
  return Math.round(exponential + jitter);
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

export async function sendOutboundMessageWithRetry(params: {
  config: BotBridgeConfig;
  payload: OutboundCallbackPayload;
  logger: PluginLogger;
  traceId: string;
}): Promise<OutboundAttemptResult> {
  const { config, payload, logger, traceId } = params;
  const body = JSON.stringify(payload);

  for (let attempt = 1; attempt <= config.retryMaxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        config.outboundApiUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.outboundToken}`,
            "Idempotency-Key": payload.delivery_id,
          },
          body,
        },
        config.requestTimeoutMs,
      );

      if (response.ok) {
        logger.info(
          `botbridge outbound success ${JSON.stringify({
            trace_id: traceId,
            channel: CHANNEL_ID,
            delivery_id: payload.delivery_id,
            botid: payload.botid,
            attempt,
            status: response.status,
          })}`,
        );
        return { ok: true, attempts: attempt, statusCode: response.status };
      }

      const retryable = isRetryableStatus(response.status);
      const responseBody = await response.text();

      logger.warn(
        `botbridge outbound non-2xx ${JSON.stringify({
          trace_id: traceId,
          channel: CHANNEL_ID,
          delivery_id: payload.delivery_id,
          botid: payload.botid,
          attempt,
          status: response.status,
          retryable,
          response: responseBody.slice(0, 300),
        })}`,
      );

      if (!retryable || attempt >= config.retryMaxAttempts) {
        return {
          ok: false,
          attempts: attempt,
          error: `outbound API returned ${response.status}`,
          statusCode: response.status,
          retryable,
        };
      }

      await sleep(computeBackoffMs(config.retryBaseDelayMs, attempt));
    } catch (error) {
      const retryable = true;
      const errorMessage = summarizeError(error);

      logger.warn(
        `botbridge outbound request error ${JSON.stringify({
          trace_id: traceId,
          channel: CHANNEL_ID,
          delivery_id: payload.delivery_id,
          botid: payload.botid,
          attempt,
          retryable,
          error: errorMessage,
        })}`,
      );

      if (attempt >= config.retryMaxAttempts) {
        return {
          ok: false,
          attempts: attempt,
          error: errorMessage,
          retryable,
        };
      }

      await sleep(computeBackoffMs(config.retryBaseDelayMs, attempt));
    }
  }

  return {
    ok: false,
    attempts: config.retryMaxAttempts,
    error: "unexpected outbound retry state",
    retryable: true,
  };
}
