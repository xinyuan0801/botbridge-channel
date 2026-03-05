import { describe, expect, it } from "vitest";
import { resolveBotBridgeConfig } from "../src/config.js";

describe("resolveBotBridgeConfig", () => {
  it("uses minimal plugin config", () => {
    const config = resolveBotBridgeConfig({
      inboundToken: "in-token",
      outboundToken: "out-token",
      outboundApiUrl: "https://example.com/send",
    });

    expect(config.enabled).toBe(true);
    expect(config.webhookPath).toBe("/openclaw-botbridge/webhook");
    expect(config.inboundToken).toBe("in-token");
    expect(config.inboundSignatureHeader).toBe("x-botbridge-signature");
    expect(config.outboundToken).toBe("out-token");
    expect(config.outboundApiUrl).toBe("https://example.com/send");
  });

  it("falls back to channels.openclaw-botbridge", () => {
    const config = resolveBotBridgeConfig(
      {},
      {
        channels: {
          "openclaw-botbridge": {
            enabled: true,
            inboundToken: "channel-in-token",
            outboundToken: "channel-out-token",
            outboundApiUrl: "https://example.com/channel-send",
          },
        },
      },
    );

    expect(config.enabled).toBe(true);
    expect(config.inboundToken).toBe("channel-in-token");
    expect(config.outboundToken).toBe("channel-out-token");
    expect(config.outboundApiUrl).toBe("https://example.com/channel-send");
  });
});
