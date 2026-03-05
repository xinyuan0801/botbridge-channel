import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendOutboundMessageWithRetry } from "../src/bridge/sender.js";
import { CHANNEL_ID } from "../src/constants.js";

async function startScriptedServer(statuses: number[]) {
  const receivedBodies: Array<Record<string, unknown>> = [];
  let requestCount = 0;

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    requestCount += 1;
    const body = Buffer.concat(chunks).toString("utf8");
    receivedBodies.push(JSON.parse(body) as Record<string, unknown>);

    const status = statuses[Math.min(requestCount - 1, statuses.length - 1)] ?? 500;
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start test server");
  }

  return {
    url: `http://127.0.0.1:${address.port}/send`,
    server,
    getRequestCount: () => requestCount,
    getReceivedBodies: () => receivedBodies,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendOutboundMessageWithRetry", () => {
  it("retries on 5xx and succeeds on later attempt", async () => {
    const scripted = await startScriptedServer([500, 500, 200]);

    const logger = {
      info: vi.fn<(message: string) => void>(),
      warn: vi.fn<(message: string) => void>(),
      error: vi.fn<(message: string) => void>(),
    };

    const result = await sendOutboundMessageWithRetry({
      config: {
        enabled: true,
        webhookPath: "/openclaw-botbridge/webhook",
        inboundToken: "in-token",
        inboundSignatureHeader: "x-botbridge-signature",
        outboundApiUrl: scripted.url,
        outboundToken: "out-token",
        requestTimeoutMs: 3000,
        retryMaxAttempts: 3,
        retryBaseDelayMs: 1,
        dedupeTtlMs: 600000,
        maxBodyBytes: 65536,
        textMaxChars: 8000,
      },
      traceId: "trace-1",
      logger,
      payload: {
        delivery_id: "evt-1",
        botid: "bot-123",
        text: "hello",
        in_reply_to: "evt-1",
        timestamp: Date.now(),
        channel: CHANNEL_ID,
      },
    });

    expect(result.ok).toBe(true);
    expect(scripted.getRequestCount()).toBe(3);
    expect(scripted.getReceivedBodies()).toHaveLength(3);

    await new Promise<void>((resolve, reject) => {
      scripted.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("does not retry on 4xx", async () => {
    const scripted = await startScriptedServer([400, 200, 200]);

    const logger = {
      info: vi.fn<(message: string) => void>(),
      warn: vi.fn<(message: string) => void>(),
      error: vi.fn<(message: string) => void>(),
    };

    const result = await sendOutboundMessageWithRetry({
      config: {
        enabled: true,
        webhookPath: "/openclaw-botbridge/webhook",
        inboundToken: "in-token",
        inboundSignatureHeader: "x-botbridge-signature",
        outboundApiUrl: scripted.url,
        outboundToken: "out-token",
        requestTimeoutMs: 3000,
        retryMaxAttempts: 3,
        retryBaseDelayMs: 1,
        dedupeTtlMs: 600000,
        maxBodyBytes: 65536,
        textMaxChars: 8000,
      },
      traceId: "trace-2",
      logger,
      payload: {
        delivery_id: "evt-2",
        botid: "bot-123",
        text: "hello",
        in_reply_to: "evt-2",
        timestamp: Date.now(),
        channel: CHANNEL_ID,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.statusCode).toBe(400);
    expect(scripted.getRequestCount()).toBe(1);

    await new Promise<void>((resolve, reject) => {
      scripted.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
});
