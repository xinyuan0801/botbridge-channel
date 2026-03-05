import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CHANNEL_ID } from "../constants.js";
import type { BotBridgeConfig } from "../config.js";
import type { PluginLogger, PluginRuntime } from "../openclaw-types.js";
import { validateInboundWebhookPayload } from "../types.js";
import type { InboundWebhookPayload, OutboundCallbackPayload } from "../types.js";
import { dispatchInboundTurn } from "../bridge/dispatch.js";
import { sendOutboundMessageWithRetry, type OutboundAttemptResult } from "../bridge/sender.js";
import { DedupeStore } from "../state/dedupe.js";
import { PerKeySerialQueue } from "../state/per-key-queue.js";
import {
  isValidHmacSha256Base64Signature,
  readSingleHeaderValue,
} from "./auth.js";
import { HttpBodyError, parseJsonBody, readRawBody } from "./body.js";

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  if (res.headersSent) {
    return;
  }
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(body);
}

function logQueueError(logger: PluginLogger, error: unknown, botid: string): void {
  logger.error(
    `botbridge queue task failed ${JSON.stringify({
      botid,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })}`,
  );
}

async function processInboundMessage(params: {
  payload: InboundWebhookPayload;
  traceId: string;
  config: BotBridgeConfig;
  logger: PluginLogger;
  runtime: PluginRuntime;
  cfg: unknown;
  sendOutbound: (params: {
    config: BotBridgeConfig;
    payload: OutboundCallbackPayload;
    logger: PluginLogger;
    traceId: string;
  }) => Promise<OutboundAttemptResult>;
  dispatchInbound: (params: {
    runtime: PluginRuntime;
    cfg: unknown;
    logger: PluginLogger;
    payload: InboundWebhookPayload;
  }) => Promise<{ selectedText: string | null }>;
}): Promise<void> {
  const { payload, traceId, config, logger, runtime, cfg, sendOutbound, dispatchInbound } = params;

  try {
    const dispatchResult = await dispatchInbound({
      runtime,
      cfg,
      logger,
      payload,
    });

    if (!dispatchResult.selectedText) {
      logger.info(
        `botbridge no reply text produced ${JSON.stringify({
          trace_id: traceId,
          event_id: payload.event_id,
          botid: payload.botid,
        })}`,
      );
      return;
    }

    const outboundPayload: OutboundCallbackPayload = {
      delivery_id: payload.event_id,
      botid: payload.botid,
      text: dispatchResult.selectedText,
      in_reply_to: payload.event_id,
      timestamp: Date.now(),
      channel: CHANNEL_ID,
    };

    const sendResult = await sendOutbound({
      config,
      payload: outboundPayload,
      logger,
      traceId,
    });

    if (!sendResult.ok) {
      logger.error(
        `botbridge outbound failed ${JSON.stringify({
          trace_id: traceId,
          event_id: payload.event_id,
          botid: payload.botid,
          attempts: sendResult.attempts,
          status: sendResult.statusCode,
          retryable: sendResult.retryable,
          error: sendResult.error,
        })}`,
      );
    }
  } catch (error) {
    logger.error(
      `botbridge process inbound failed ${JSON.stringify({
        trace_id: traceId,
        event_id: payload.event_id,
        botid: payload.botid,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      })}`,
    );
  }
}

export function createWebhookHandler(params: {
  getConfig: () => BotBridgeConfig;
  logger: PluginLogger;
  runtime: PluginRuntime;
  cfg: unknown;
  dedupeStore?: DedupeStore;
  queue?: PerKeySerialQueue;
  traceIdFactory?: () => string;
  sendOutbound?: (params: {
    config: BotBridgeConfig;
    payload: OutboundCallbackPayload;
    logger: PluginLogger;
    traceId: string;
  }) => Promise<OutboundAttemptResult>;
  dispatchInbound?: (params: {
    runtime: PluginRuntime;
    cfg: unknown;
    logger: PluginLogger;
    payload: InboundWebhookPayload;
  }) => Promise<{ selectedText: string | null }>;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const dedupe = params.dedupeStore ?? new DedupeStore();
  const queue =
    params.queue ??
    new PerKeySerialQueue((error, key) => {
      logQueueError(params.logger, error, key);
    });
  const sendOutbound = params.sendOutbound ?? sendOutboundMessageWithRetry;
  const dispatchInbound = params.dispatchInbound ?? dispatchInboundTurn;
  const traceIdFactory = params.traceIdFactory ?? randomUUID;

  return async (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return true;
    }

    const config = params.getConfig();
    if (!config.enabled) {
      sendJson(res, 503, { error: "plugin disabled" });
      return true;
    }
    if (!config.inboundToken) {
      sendJson(res, 503, { error: "inbound token is not configured" });
      return true;
    }

    try {
      const rawBody = await readRawBody(req, config.maxBodyBytes);
      const signatureHeaderName = config.inboundSignatureHeader || "x-botbridge-signature";
      const signature = readSingleHeaderValue(req, signatureHeaderName)?.trim();
      if (!signature) {
        sendJson(res, 400, {
          error: `missing ${signatureHeaderName} header`,
        });
        return true;
      }

      if (
        !isValidHmacSha256Base64Signature({
          rawBody,
          signature,
          secret: config.inboundToken,
        })
      ) {
        sendJson(res, 401, { error: "invalid signature" });
        return true;
      }

      const rawBodyJson = parseJsonBody(rawBody);
      const validation = validateInboundWebhookPayload(rawBodyJson, config.textMaxChars);
      if (!validation.ok) {
        sendJson(res, validation.status, { error: validation.error });
        return true;
      }

      const inboundPayload = validation.value;
      const duplicate = dedupe.isDuplicateAndMark(inboundPayload.event_id, config.dedupeTtlMs);
      if (duplicate) {
        sendJson(res, 200, { accepted: true, duplicate: true });
        return true;
      }

      const traceId = traceIdFactory();
      sendJson(res, 202, { accepted: true, trace_id: traceId });

      void queue.enqueue(inboundPayload.botid, () =>
        processInboundMessage({
          payload: inboundPayload,
          traceId,
          config,
          logger: params.logger,
          runtime: params.runtime,
          cfg: params.cfg,
          sendOutbound,
          dispatchInbound,
        }),
      );

      return true;
    } catch (error) {
      if (error instanceof HttpBodyError) {
        sendJson(res, error.statusCode, { error: error.message });
        return true;
      }

      params.logger.error(
        `botbridge webhook handler failed ${JSON.stringify({
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        })}`,
      );
      sendJson(res, 500, { error: "internal error" });
      return true;
    }
  };
}
