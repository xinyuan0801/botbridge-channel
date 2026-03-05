import { createServer } from "node:http";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebhookHandler } from "../src/http/webhook.js";
import type { BotBridgeConfig } from "../src/config.js";
import type { InboundWebhookPayload, OutboundCallbackPayload } from "../src/types.js";

function createConfig(overrides: Partial<BotBridgeConfig> = {}): BotBridgeConfig {
  return {
    enabled: true,
    webhookPath: "/openclaw-botbridge/webhook",
    inboundToken: "in-token",
    inboundSignatureHeader: "x-botbridge-signature",
    outboundApiUrl: "http://localhost:9999/send",
    outboundToken: "out-token",
    requestTimeoutMs: 3000,
    retryMaxAttempts: 3,
    retryBaseDelayMs: 1,
    dedupeTtlMs: 600000,
    maxBodyBytes: 65536,
    textMaxChars: 8000,
    ...overrides,
  };
}

function signBody(rawBody: string, token: string): string {
  return createHmac("SHA256", token).update(rawBody).digest("base64");
}

async function startTestServer(handler: ReturnType<typeof createWebhookHandler>) {
  const server = createServer(async (req, res) => {
    await handler(req, res);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start server");
  }

  return {
    url: `http://127.0.0.1:${address.port}/openclaw-botbridge/webhook`,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timeout waiting for condition");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWebhookHandler", () => {
  it("accepts valid signed request and processes asynchronously", async () => {
    const outboundCalls: OutboundCallbackPayload[] = [];

    const handler = createWebhookHandler({
      getConfig: () => createConfig(),
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      runtime: {},
      cfg: {},
      dispatchInbound: async () => ({ selectedText: "robot reply" }),
      sendOutbound: async ({ payload }) => {
        outboundCalls.push(payload);
        return { ok: true, attempts: 1, statusCode: 200 };
      },
      traceIdFactory: () => "trace-1",
    });

    const server = await startTestServer(handler);

    const rawBody = JSON.stringify({ event_id: "evt-1", botid: "bot-1", text: "hello" });
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-botbridge-signature": signBody(rawBody, "in-token"),
      },
      body: rawBody,
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true, trace_id: "trace-1" });

    await waitFor(() => outboundCalls.length === 1);
    expect(outboundCalls[0]).toMatchObject({
      delivery_id: "evt-1",
      botid: "bot-1",
      text: "robot reply",
      in_reply_to: "evt-1",
      channel: "openclaw-botbridge",
    });

    await server.close();
  });

  it("returns duplicate on same event_id replay", async () => {
    const outboundCalls: OutboundCallbackPayload[] = [];

    const handler = createWebhookHandler({
      getConfig: () => createConfig(),
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      runtime: {},
      cfg: {},
      dispatchInbound: async () => ({ selectedText: "ok" }),
      sendOutbound: async ({ payload }) => {
        outboundCalls.push(payload);
        return { ok: true, attempts: 1, statusCode: 200 };
      },
      traceIdFactory: () => "trace-dup",
    });

    const server = await startTestServer(handler);

    const reqBody = { event_id: "evt-dup", botid: "bot-1", text: "hello" };
    const rawBody = JSON.stringify(reqBody);
    const signature = signBody(rawBody, "in-token");

    const first = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-botbridge-signature": signature,
      },
      body: rawBody,
    });
    expect(first.status).toBe(202);

    const second = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-botbridge-signature": signature,
      },
      body: rawBody,
    });

    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ accepted: true, duplicate: true });

    await waitFor(() => outboundCalls.length === 1);
    expect(outboundCalls).toHaveLength(1);

    await server.close();
  });

  it("returns 400 when signature header is missing", async () => {
    const handler = createWebhookHandler({
      getConfig: () => createConfig(),
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      runtime: {},
      cfg: {},
      dispatchInbound: async () => ({ selectedText: "ignored" }),
      sendOutbound: async () => ({ ok: true, attempts: 1, statusCode: 200 }),
    });

    const server = await startTestServer(handler);

    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event_id: "evt-auth", botid: "bot-1", text: "hello" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "missing x-botbridge-signature header" });

    await server.close();
  });

  it("returns 401 when signature is invalid", async () => {
    const handler = createWebhookHandler({
      getConfig: () => createConfig(),
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      runtime: {},
      cfg: {},
      dispatchInbound: async () => ({ selectedText: "ignored" }),
      sendOutbound: async () => ({ ok: true, attempts: 1, statusCode: 200 }),
    });

    const server = await startTestServer(handler);

    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-botbridge-signature": "bad-signature",
      },
      body: JSON.stringify({ event_id: "evt-badsig", botid: "bot-1", text: "hello" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid signature" });

    await server.close();
  });

  it("returns 400 for invalid json", async () => {
    const handler = createWebhookHandler({
      getConfig: () => createConfig(),
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      runtime: {},
      cfg: {},
      dispatchInbound: async () => ({ selectedText: "ignored" }),
      sendOutbound: async () => ({ ok: true, attempts: 1, statusCode: 200 }),
    });

    const server = await startTestServer(handler);

    const rawBody = "{not-json";
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-botbridge-signature": signBody(rawBody, "in-token"),
      },
      body: rawBody,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid JSON body" });

    await server.close();
  });

  it("returns 422 for empty text", async () => {
    const handler = createWebhookHandler({
      getConfig: () => createConfig(),
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      runtime: {},
      cfg: {},
      dispatchInbound: async () => ({ selectedText: "ignored" }),
      sendOutbound: async () => ({ ok: true, attempts: 1, statusCode: 200 }),
    });

    const server = await startTestServer(handler);

    const rawBody = JSON.stringify({ event_id: "evt-empty", botid: "bot-1", text: "   " });
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-botbridge-signature": signBody(rawBody, "in-token"),
      },
      body: rawBody,
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "text must not be empty" });

    await server.close();
  });

  it("returns 413 when body exceeds maxBodyBytes", async () => {
    const handler = createWebhookHandler({
      getConfig: () => createConfig({ maxBodyBytes: 30 }),
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      runtime: {},
      cfg: {},
      dispatchInbound: async () => ({ selectedText: "ignored" }),
      sendOutbound: async () => ({ ok: true, attempts: 1, statusCode: 200 }),
    });

    const server = await startTestServer(handler);

    const rawBody = JSON.stringify({
      event_id: "evt-big",
      botid: "bot-1",
      text: "hello",
      metadata: { veryLarge: "x".repeat(200) },
    });

    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-botbridge-signature": signBody(rawBody, "in-token"),
      },
      body: rawBody,
    });

    expect(response.status).toBe(413);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("request body too large");

    await server.close();
  });

  it("processes same botid requests in serial order", async () => {
    const sendOrder: string[] = [];

    const handler = createWebhookHandler({
      getConfig: () => createConfig(),
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      runtime: {},
      cfg: {},
      dispatchInbound: async ({ payload }: { payload: InboundWebhookPayload }) => {
        if (payload.event_id === "evt-first") {
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        return { selectedText: `reply-${payload.event_id}` };
      },
      sendOutbound: async ({ payload }) => {
        sendOrder.push(payload.delivery_id);
        return { ok: true, attempts: 1, statusCode: 200 };
      },
    });

    const server = await startTestServer(handler);

    const bodyFirst = JSON.stringify({ event_id: "evt-first", botid: "bot-serial", text: "1" });
    const bodySecond = JSON.stringify({
      event_id: "evt-second",
      botid: "bot-serial",
      text: "2",
    });

    await Promise.all([
      fetch(server.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-botbridge-signature": signBody(bodyFirst, "in-token"),
        },
        body: bodyFirst,
      }),
      fetch(server.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-botbridge-signature": signBody(bodySecond, "in-token"),
        },
        body: bodySecond,
      }),
    ]);

    await waitFor(() => sendOrder.length === 2);
    expect(sendOrder).toEqual(["evt-first", "evt-second"]);

    await server.close();
  });

  it("returns 503 when inbound token is not configured", async () => {
    const handler = createWebhookHandler({
      getConfig: () => createConfig({ inboundToken: "" }),
      logger: {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
      },
      runtime: {},
      cfg: {},
      dispatchInbound: async () => ({ selectedText: "ignored" }),
      sendOutbound: async () => ({ ok: true, attempts: 1, statusCode: 200 }),
    });

    const server = await startTestServer(handler);

    const rawBody = JSON.stringify({ event_id: "evt-1", botid: "bot-1", text: "hello" });
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-botbridge-signature": signBody(rawBody, "in-token"),
      },
      body: rawBody,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "inbound token is not configured" });

    await server.close();
  });
});
