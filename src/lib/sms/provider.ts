/** A single outbound text message. */
export type SmsMessage = { to: string; body: string };

/**
 * `skipped` means nothing was attempted (provider not configured, no message);
 * `failed` means the gateway rejected it and a later run should retry.
 */
export type SmsOutcome = { status: "sent" | "failed" | "skipped"; reference?: string; error?: string };

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsOutcome>;
}
