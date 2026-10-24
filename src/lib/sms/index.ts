import "server-only";
import { mockSmsProvider } from "./mock";
import type { SmsMessage, SmsOutcome, SmsProvider } from "./provider";

export type { SmsMessage, SmsOutcome, SmsProvider } from "./provider";

/**
 * Provider selection, by `SMS_PROVIDER`:
 *
 *   mock (default)  offline, deterministic, no credentials
 *   msg91           MSG91 Flow API; needs SMS_API_KEY, SMS_SENDER_ID and
 *                   SMS_TEMPLATE_ID. Add an adapter here for another gateway.
 *
 * An unconfigured gateway returns `skipped` rather than throwing, so a missing
 * key never fails the nightly job — the delivery row records why nothing went.
 */
const msg91: SmsProvider = {
  name: "msg91",

  async send({ to, body }: SmsMessage): Promise<SmsOutcome> {
    const key = process.env.SMS_API_KEY;
    const sender = process.env.SMS_SENDER_ID;
    const template = process.env.SMS_TEMPLATE_ID;
    if (!key || !sender || !template) return { status: "skipped", error: "SMS provider is not configured" };

    const res = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: key },
      body: JSON.stringify({
        template_id: template,
        sender,
        recipients: [{ mobiles: to.replace(/\D/g, ""), message: body }],
      }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) return { status: "failed", error: `MSG91 returned HTTP ${res.status}: ${text.slice(0, 200)}` };
    return { status: "sent", reference: text.slice(0, 120) };
  },
};

export function smsProvider(): SmsProvider {
  return process.env.SMS_PROVIDER === "msg91" ? msg91 : mockSmsProvider;
}
