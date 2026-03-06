import { CHANNEL_ID } from "../constants.js";
import type { OpenClawConfig, PluginLogger, PluginRuntime, ReplyPayload } from "openclaw/plugin-sdk";
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

  // Some runtimes prepend reply tags like [[reply_to_current]]; strip for channel egress.
  const withoutReplyTag = payload.text.replace(/^\s*\[\[[^\]]+\]\]\s*/u, "");
  const trimmed = withoutReplyTag.trim();
  return trimmed ? trimmed : null;
}

export async function dispatchInboundTurn(params: {
  runtime: PluginRuntime;
  cfg: OpenClawConfig;
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
  const peerId = `${CHANNEL_ID}:${params.payload.botid}`;

  const ctx: Record<string, unknown> = {
    From: peerId,
    To: peerId,
    SessionKey: `${CHANNEL_ID}:direct:${params.payload.botid}`,
    Body: params.payload.text,
    RawBody: params.payload.text,
    CommandBody: params.payload.text,
    ChatType: "direct",
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: peerId,
    Timestamp: params.payload.timestamp ?? Date.now(),
    MessageSid: params.payload.event_id,
  };

  await dispatcher({
    ctx,
    cfg: params.cfg,
    dispatcherOptions: {
      deliver: async (replyPayload, info) => {
        const text = extractNonEmptyText(replyPayload);
        params.logger.info(
          `botbridge dispatch chunk ${JSON.stringify({
            kind: info.kind,
            hasText: typeof replyPayload.text === "string",
            isReasoning: Boolean(replyPayload.isReasoning),
            extracted: text,
          })}`,
        );
        if (!text) {
          return;
        }

        if (info.kind === "final") {
          finalText = text;
          return;
        }

        if (info.kind === "block") {
          fallbackBlockText = text;
          return;
        }

        // Compatibility fallback: some runtimes may emit text on non-final/non-block kinds.
        if (!fallbackBlockText) {
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
