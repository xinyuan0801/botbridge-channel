import { CHANNEL_ID } from "./constants.js";

export type InboundWebhookPayload = {
  event_id: string;
  botid: string;
  text: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

export type OutboundCallbackPayload = {
  delivery_id: string;
  botid: string;
  text: string;
  in_reply_to: string;
  timestamp: number;
  channel: typeof CHANNEL_ID;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateInboundWebhookPayload(
  raw: unknown,
  textMaxChars: number,
): ValidationResult<InboundWebhookPayload> {
  if (!isRecord(raw)) {
    return {
      ok: false,
      status: 400,
      error: "request body must be a JSON object",
    };
  }

  const eventIdRaw = raw.event_id;
  const botIdRaw = raw.botid;
  const textRaw = raw.text;

  if (typeof eventIdRaw !== "string" || !eventIdRaw.trim()) {
    return { ok: false, status: 422, error: "event_id must be a non-empty string" };
  }

  if (typeof botIdRaw !== "string" || !botIdRaw.trim()) {
    return { ok: false, status: 422, error: "botid must be a non-empty string" };
  }

  if (typeof textRaw !== "string") {
    return { ok: false, status: 422, error: "text must be a string" };
  }

  if (!textRaw.trim()) {
    return { ok: false, status: 422, error: "text must not be empty" };
  }

  if (textRaw.length > textMaxChars) {
    return {
      ok: false,
      status: 422,
      error: `text exceeds max length ${textMaxChars}`,
    };
  }

  const timestampRaw = raw.timestamp;
  if (
    timestampRaw !== undefined &&
    (typeof timestampRaw !== "number" || !Number.isFinite(timestampRaw))
  ) {
    return {
      ok: false,
      status: 422,
      error: "timestamp must be a finite number when provided",
    };
  }

  const metadataRaw = raw.metadata;
  if (metadataRaw !== undefined && !isRecord(metadataRaw)) {
    return {
      ok: false,
      status: 422,
      error: "metadata must be an object when provided",
    };
  }

  return {
    ok: true,
    value: {
      event_id: eventIdRaw.trim(),
      botid: botIdRaw.trim(),
      text: textRaw,
      ...(timestampRaw !== undefined ? { timestamp: timestampRaw } : {}),
      ...(metadataRaw !== undefined ? { metadata: metadataRaw } : {}),
    },
  };
}
