import { randomUUID } from "node:crypto";
import { CHANNEL_ID } from "./constants.js";
import { type BotBridgeConfig } from "./config.js";
import { sendOutboundMessageWithRetry } from "./bridge/sender.js";
import type { OpenClawPluginApi, OutboundSendResult, PluginLogger } from "./openclaw-types.js";

export type BotBridgeAccount = {
  accountId: string;
  config: BotBridgeConfig;
};

export type ChannelPluginLike = {
  id: string;
  meta: {
    id: string;
    label: string;
    selectionLabel: string;
    docsPath: string;
    blurb: string;
    aliases?: string[];
    order?: number;
  };
  capabilities: {
    chatTypes: ["direct"];
    supports: {
      mentions: false;
      threads: false;
      reactions: false;
      edits: false;
      deletions: false;
      formatting: false;
      voice: false;
      video: false;
    };
  };
  config: {
    listAccountIds: () => string[];
    resolveAccount: (_cfg: unknown, accountId?: string | null) => BotBridgeAccount;
  };
  outbound: {
    deliveryMode: "direct";
    sendText: (ctx: {
      to: string;
      text: string;
    }) => Promise<OutboundSendResult>;
  };
};

export function createChannelPlugin(params: {
  getConfig: () => BotBridgeConfig;
  logger: PluginLogger;
  api: Pick<OpenClawPluginApi, "config">;
}): ChannelPluginLike {
  const resolveAccount = (accountId?: string | null): BotBridgeAccount => ({
    accountId: accountId?.trim() || "default",
    config: params.getConfig(),
  });

  return {
    id: CHANNEL_ID,
    meta: {
      id: CHANNEL_ID,
      label: "BotBridge",
      selectionLabel: "BotBridge (1v1 Webhook)",
      docsPath: "/channels/openclaw-botbridge",
      blurb: "Webhook inbound + REST outbound bridge for 1v1 chatbot integrations.",
      aliases: ["botbridge"],
      order: 220,
    },
    capabilities: {
      chatTypes: ["direct"],
      supports: {
        mentions: false,
        threads: false,
        reactions: false,
        edits: false,
        deletions: false,
        formatting: false,
        voice: false,
        video: false,
      },
    },
    config: {
      listAccountIds: () => ["default"],
      resolveAccount: (_cfg, accountId) => resolveAccount(accountId),
    },
    outbound: {
      deliveryMode: "direct",
      sendText: async (ctx) => {
        const config = params.getConfig();
        if (!config.outboundApiUrl || !config.outboundToken) {
          return {
            ok: false,
            error: "outboundApiUrl/outboundToken is not configured",
          };
        }

        const deliveryId = randomUUID();
        const sendResult = await sendOutboundMessageWithRetry({
          config,
          logger: params.logger,
          traceId: deliveryId,
          payload: {
            delivery_id: deliveryId,
            botid: ctx.to,
            text: ctx.text,
            in_reply_to: deliveryId,
            timestamp: Date.now(),
            channel: CHANNEL_ID,
          },
        });

        if (!sendResult.ok) {
          return {
            ok: false,
            error: sendResult.error,
          };
        }

        return { ok: true };
      },
    },
  };
}
