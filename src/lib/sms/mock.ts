import type { SmsMessage, SmsOutcome, SmsProvider } from "./provider";

/**
 * Deterministic, offline stand-in for an SMS gateway.
 *
 *   fewer than 10 digits after normalising -> failed (bad number)
 *   number ending in 0000                  -> failed (mock gateway rejection)
 *   empty body                             -> skipped
 *   anything else                          -> sent with a generated reference
 *
 * No network, no credentials. The queue, the opt-in and the delivery log are
 * real; only the gateway is simulated.
 */
export const mockSmsProvider: SmsProvider = {
  name: "mock",

  async send({ to, body }: SmsMessage): Promise<SmsOutcome> {
    const phone = to.replace(/[^\d+]/g, "");
    if (!/^\+?\d{10,15}$/.test(phone)) return { status: "failed", error: "Not a valid mobile number" };
    if (phone.endsWith("0000")) return { status: "failed", error: "Mock gateway rejected the number" };
    if (body.trim() === "") return { status: "skipped", error: "Empty message" };
    return { status: "sent", reference: `MOCK-SMS/${phone.slice(-4)}/${Date.now().toString(36)}` };
  },
};
