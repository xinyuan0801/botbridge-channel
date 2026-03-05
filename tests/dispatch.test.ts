import { describe, expect, it, vi } from "vitest";
import { dispatchInboundTurn } from "../src/bridge/dispatch.js";

describe("dispatchInboundTurn", () => {
  it("prefers final reply text over block text", async () => {
    const dispatch = vi.fn(async (params: {
      dispatcherOptions: {
        deliver: (payload: { text?: string }, info: { kind: "tool" | "block" | "final" }) =>
          Promise<void> | void;
      };
    }) => {
      await params.dispatcherOptions.deliver({ text: "block message" }, { kind: "block" });
      await params.dispatcherOptions.deliver({ text: "final message" }, { kind: "final" });
    });

    const result = await dispatchInboundTurn({
      runtime: {
        channel: {
          reply: {
            dispatchReplyWithBufferedBlockDispatcher: dispatch,
          },
        },
      },
      cfg: {},
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      payload: {
        event_id: "evt-1",
        botid: "bot-1",
        text: "hello",
      },
    });

    expect(result.fallbackBlockText).toBe("block message");
    expect(result.finalText).toBe("final message");
    expect(result.selectedText).toBe("final message");
  });

  it("falls back to last block text when final is absent", async () => {
    const dispatch = vi.fn(async (params: {
      dispatcherOptions: {
        deliver: (payload: { text?: string }, info: { kind: "tool" | "block" | "final" }) =>
          Promise<void> | void;
      };
    }) => {
      await params.dispatcherOptions.deliver({ text: "first block" }, { kind: "block" });
      await params.dispatcherOptions.deliver({ text: "second block" }, { kind: "block" });
    });

    const result = await dispatchInboundTurn({
      runtime: {
        channel: {
          reply: {
            dispatchReplyWithBufferedBlockDispatcher: dispatch,
          },
        },
      },
      cfg: {},
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      payload: {
        event_id: "evt-2",
        botid: "bot-1",
        text: "hello",
      },
    });

    expect(result.finalText).toBeNull();
    expect(result.fallbackBlockText).toBe("second block");
    expect(result.selectedText).toBe("second block");
  });
});
