import {
  BillingWebhookProjectionError,
  BillingWebhookValidationError,
  BillingWebhookVerificationError,
} from "../../application/billing-webhook.js";
import type { PrivateApiDependencies } from "../private-api.js";
import { sendJson } from "../transport.js";
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_WEBHOOK_BYTES = 262_144;

const readRawBody = async (request: IncomingMessage): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_WEBHOOK_BYTES) throw new BillingWebhookValidationError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export const handleBillingWebhook = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: PrivateApiDependencies,
): Promise<boolean> => {
  if (request.method !== "POST" || pathname !== "/api/v1/webhooks/stripe") return false;
  if (!dependencies.billingWebhook) {
    sendJson(response, 503, {
      code: "BILLING_WEBHOOK_UNAVAILABLE",
      message: "Webhook indisponível.",
    });
    return true;
  }
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    sendJson(response, 415, {
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Envie o corpo como application/json.",
    });
    return true;
  }
  const signature = request.headers["stripe-signature"];
  if (typeof signature !== "string") {
    sendJson(response, 400, { code: "INVALID_WEBHOOK", message: "Webhook inválido." });
    return true;
  }
  try {
    const result = await dependencies.billingWebhook.handle(
      await readRawBody(request), signature,
    );
    sendJson(response, 200, { received: true, outcome: result.outcome });
  } catch (error) {
    if (
      error instanceof BillingWebhookValidationError ||
      error instanceof BillingWebhookVerificationError ||
      error instanceof BillingWebhookProjectionError
    ) {
      sendJson(response, 400, { code: "INVALID_WEBHOOK", message: "Webhook inválido." });
    } else {
      sendJson(response, 503, {
        code: "BILLING_WEBHOOK_UNAVAILABLE",
        message: "Webhook temporariamente indisponível.",
      });
    }
  }
  return true;
};
