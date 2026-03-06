import { randomUUID } from "node:crypto";
import { CHANNEL_ID } from "./constants.js";
import { type BotBridgeConfig } from "./config.js";
import { sendOutboundMessageWithRetry } from "./bridge/sender.js";
import type {
  ChannelOutboundAdapter,
  ChannelPlugin,
  OpenClawConfig,
  PluginLogger,
} from "openclaw/plugin-sdk";

export type BotBridgeAccount = {
  accountId: string;
  config: BotBridgeConfig;
};

type SendTextResult = Awaited<ReturnType<NonNullable<ChannelOutboundAdapter["sendText"]>>>;

export function createChannelPlugin(params: {
  getConfig: () => BotBridgeConfig;
  logger: PluginLogger;
}): ChannelPlugin<BotBridgeAccount> {
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
    },
    config: {
      listAccountIds: (_cfg: OpenClawConfig) => ["default"],
      resolveAccount: (_cfg, accountId) => resolveAccount(accountId),
    },
    outbound: {
      deliveryMode: "direct",
      sendText: async (ctx) => {
        const config = params.getConfig();
        if (!config.outboundApiUrl || !config.outboundToken) {
          throw new Error("outboundApiUrl/outboundToken is not configured");
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
          throw new Error(sendResult.error);
        }

        const outboundResult: SendTextResult = {
          channel: CHANNEL_ID,
          messageId: deliveryId,
          timestamp: Date.now(),
        };
        return outboundResult;
      },
    },
  };
}
