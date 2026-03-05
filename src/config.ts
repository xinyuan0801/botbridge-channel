import { CHANNEL_ID, DEFAULT_WEBHOOK_PATH } from "./constants.js";

export type BotBridgeConfig = {
  enabled: boolean;
  webhookPath: string;
  inboundToken: string;
  inboundSignatureHeader: string;
  outboundApiUrl: string;
  outboundToken: string;
  requestTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  dedupeTtlMs: number;
  maxBodyBytes: number;
  textMaxChars: number;
};

const DEFAULTS: Omit<BotBridgeConfig, "inboundToken" | "outboundApiUrl" | "outboundToken"> = {
  enabled: true,
  webhookPath: DEFAULT_WEBHOOK_PATH,
  inboundSignatureHeader: "x-botbridge-signature",
  requestTimeoutMs: 8000,
  retryMaxAttempts: 3,
  retryBaseDelayMs: 500,
  dedupeTtlMs: 600000,
  maxBodyBytes: 65536,
  textMaxChars: 8000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readChannelConfig(source: unknown, channelName: string): Record<string, unknown> {
  if (!isRecord(source)) {
    return {};
  }
  const channels = source.channels;
  if (!isRecord(channels)) {
    return {};
  }
  const channelConfig = channels[channelName];
  return isRecord(channelConfig) ? channelConfig : {};
}

function pickString(
  sources: readonly Record<string, unknown>[],
  keys: readonly string[],
  fallback = "",
): string {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value !== "string") {
        continue;
      }
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return fallback;
}

function pickBoolean(
  sources: readonly Record<string, unknown>[],
  keys: readonly string[],
  fallback: boolean,
): boolean {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "boolean") {
        return value;
      }
    }
  }
  return fallback;
}

function pickNumber(
  sources: readonly Record<string, unknown>[],
  keys: readonly string[],
  fallback: number,
): number {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
  }
  return fallback;
}

function sourceLayers(pluginRaw: unknown, rootConfigRaw?: unknown): Record<string, unknown>[] {
  const pluginSource = isRecord(pluginRaw) ? pluginRaw : {};
  const rootSource = isRecord(rootConfigRaw) ? rootConfigRaw : {};

  return [
    pluginSource,
    readChannelConfig(pluginSource, CHANNEL_ID),
    readChannelConfig(pluginSource, "openclawBotbridge"),
    readChannelConfig(pluginSource, "botbridge"),
    readChannelConfig(rootSource, CHANNEL_ID),
    readChannelConfig(rootSource, "openclawBotbridge"),
    readChannelConfig(rootSource, "botbridge"),
  ];
}

export function normalizeWebhookPath(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return DEFAULT_WEBHOOK_PATH;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function resolveBotBridgeConfig(pluginRaw: unknown, rootConfigRaw?: unknown): BotBridgeConfig {
  const sources = sourceLayers(pluginRaw, rootConfigRaw);

  return {
    enabled: pickBoolean(sources, ["enabled"], DEFAULTS.enabled),
    webhookPath: normalizeWebhookPath(pickString(sources, ["webhookPath"], DEFAULTS.webhookPath)),
    inboundToken: pickString(sources, ["inboundToken"], ""),
    inboundSignatureHeader: pickString(
      sources,
      ["inboundSignatureHeader"],
      DEFAULTS.inboundSignatureHeader,
    ).toLowerCase(),
    outboundApiUrl: pickString(sources, ["outboundApiUrl", "callbackUrl", "sendApiUrl"], ""),
    outboundToken: pickString(sources, ["outboundToken"], ""),
    requestTimeoutMs: Math.max(
      100,
      pickNumber(sources, ["requestTimeoutMs"], DEFAULTS.requestTimeoutMs),
    ),
    retryMaxAttempts: Math.max(
      1,
      Math.floor(pickNumber(sources, ["retryMaxAttempts"], DEFAULTS.retryMaxAttempts)),
    ),
    retryBaseDelayMs: Math.max(
      10,
      pickNumber(sources, ["retryBaseDelayMs"], DEFAULTS.retryBaseDelayMs),
    ),
    dedupeTtlMs: Math.max(1000, pickNumber(sources, ["dedupeTtlMs"], DEFAULTS.dedupeTtlMs)),
    maxBodyBytes: Math.max(
      1024,
      Math.floor(pickNumber(sources, ["maxBodyBytes"], DEFAULTS.maxBodyBytes)),
    ),
    textMaxChars: Math.max(
      1,
      Math.floor(pickNumber(sources, ["textMaxChars"], DEFAULTS.textMaxChars)),
    ),
  };
}

export function missingRequiredConfig(config: BotBridgeConfig): string[] {
  const missing: string[] = [];
  if (!config.inboundToken) {
    missing.push("inboundToken");
  }
  if (!config.outboundApiUrl) {
    missing.push("outboundApiUrl");
  }
  if (!config.outboundToken) {
    missing.push("outboundToken");
  }
  return missing;
}
