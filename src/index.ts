import { CHANNEL_ID } from "./constants.js";
import { createChannelPlugin } from "./channel.js";
import { missingRequiredConfig, resolveBotBridgeConfig } from "./config.js";
import { createWebhookHandler } from "./http/webhook.js";
import type { OpenClawPluginApi } from "./openclaw-types.js";

export default function register(api: OpenClawPluginApi): void {
  const getConfig = () => resolveBotBridgeConfig(api.pluginConfig ?? {}, api.config);
  const initialConfig = getConfig();

  const missing = missingRequiredConfig(initialConfig);
  if (missing.length > 0) {
    api.logger.warn(
      `botbridge missing config fields: ${missing.join(", ")}. Plugin will load but webhook/outbound may fail until configured.`,
    );
  }

  const channelPlugin = createChannelPlugin({
    getConfig,
    logger: api.logger,
    api,
  });

  api.registerChannel({ plugin: channelPlugin });

  const webhookHandler = createWebhookHandler({
    getConfig,
    logger: api.logger,
    runtime: api.runtime,
    cfg: api.config,
  });

  api.registerHttpRoute({
    path: initialConfig.webhookPath,
    auth: "plugin",
    replaceExisting: true,
    handler: webhookHandler,
  });

  api.logger.info(
    `botbridge plugin registered ${JSON.stringify({
      channel: CHANNEL_ID,
      webhookPath: initialConfig.webhookPath,
      enabled: initialConfig.enabled,
    })}`,
  );
}
