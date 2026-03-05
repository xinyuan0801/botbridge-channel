import { describe, expect, it, vi } from "vitest";
import register from "../src/index.js";

describe("plugin register", () => {
  it("registers channel and plugin-auth webhook route", () => {
    const registerChannel = vi.fn<(registration: unknown) => void>();
    const registerHttpRoute = vi.fn<
      (
        params: {
          path: string;
          auth: "gateway" | "plugin";
          replaceExisting?: boolean;
          handler: unknown;
        },
      ) => void
    >();

    register({
      id: "openclaw-botbridge",
      config: {},
      pluginConfig: {
        enabled: true,
        webhookPath: "/custom/webhook",
        inboundToken: "in-token",
        outboundApiUrl: "https://example.com/send",
        outboundToken: "out-token",
      },
      runtime: {},
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      registerChannel,
      registerHttpRoute,
    });

    expect(registerChannel).toHaveBeenCalledTimes(1);

    expect(registerHttpRoute).toHaveBeenCalledTimes(1);
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/custom/webhook",
        auth: "plugin",
        replaceExisting: true,
      }),
    );
  });
});
