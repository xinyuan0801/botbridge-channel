import { CHANNEL_ID } from "../constants.js";
import type { PluginLogger, PluginRuntime, ReplyDispatchKind, ReplyPayload } from "../openclaw-types.js";
import type { InboundWebhookPayload } from "../types.js";

export type DispatchInboundResult = {
  finalText: string | null;
  fallbackBlockText: string | null;
  selectedText: string | null;
};

function extractNonEmptyText(payload: ReplyPayload): string | null {
  if (payload.isReasoning) {
    return null;
  }
  if (typeof payload.text !== "string") {
    return null;
  }
  const trimmed = payload.text.trim();
  return trimmed ? trimmed : null;
}

export async function dispatchInboundTurn(params: {
  runtime: PluginRuntime;
  cfg: unknown;
  logger: PluginLogger;
  payload: InboundWebhookPayload;
}): Promise<DispatchInboundResult> {
  const dispatcher = params.runtime.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (!dispatcher) {
    throw new Error(
      "OpenClaw runtime missing channel.reply.dispatchReplyWithBufferedBlockDispatcher",
    );
  }

  let finalText: string | null = null;
  let fallbackBlockText: string | null = null;

  const ctx: Record<string, unknown> = {
    From: params.payload.botid,
    To: CHANNEL_ID,
    SessionKey: `${CHANNEL_ID}:direct:${params.payload.botid}`,
    Body: params.payload.text,
    RawBody: params.payload.text,
    CommandBody: params.payload.text,
    ChatType: "direct",
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: params.payload.botid,
    Timestamp: params.payload.timestamp ?? Date.now(),
    MessageSid: params.payload.event_id,
  };

  await dispatcher({
    ctx,
    cfg: params.cfg,
    dispatcherOptions: {
      deliver: async (replyPayload, info: { kind: ReplyDispatchKind }) => {
        const text = extractNonEmptyText(replyPayload);
        if (!text) {
          return;
        }

        if (info.kind === "final") {
          finalText = text;
          return;
        }

        if (info.kind === "block") {
          fallbackBlockText = text;
        }
      },
      onError: (error, info) => {
        params.logger.warn(
          `botbridge dispatch delivery callback error ${JSON.stringify({
            kind: info.kind,
            error: error instanceof Error ? error.message : String(error),
          })}`,
        );
      },
    },
  });

  return {
    finalText,
    fallbackBlockText,
    selectedText: finalText ?? fallbackBlockText,
  };
}
