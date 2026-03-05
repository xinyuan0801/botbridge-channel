import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function readSingleHeaderValue(
  req: IncomingMessage,
  headerName: string,
): string | undefined {
  const value = req.headers[headerName.toLowerCase()];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

export function isValidHmacSha256Base64Signature(params: {
  rawBody: string;
  signature: string;
  secret: string;
}): boolean {
  const expected = createHmac("SHA256", params.secret).update(params.rawBody).digest("base64");
  return safeEqual(expected, params.signature);
}
