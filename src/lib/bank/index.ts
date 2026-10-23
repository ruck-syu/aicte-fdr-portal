import "server-only";
import { mockBankVerifier } from "./mock";
import type { BankVerificationInput, BankVerificationResult, BankVerifier } from "./verifier";

export type { BankVerificationInput, BankVerificationResult, BankVerifier } from "./verifier";

/**
 * Provider selection, by `BANK_VERIFIER`:
 *
 *   mock (default)  offline, deterministic, no credentials
 *   http            POSTs the request to `BANK_VERIFIER_URL` and expects
 *                   { status, reference?, observed?, reasons? } back. Add an
 *                   adapter here for a real FI's payload/auth.
 *
 * A real integration only needs a new entry in this map; nothing downstream
 * changes, because the outcome is applied by `record_bank_verification()`.
 */
const httpVerifier: BankVerifier = {
  name: "http",

  async verify(input: BankVerificationInput): Promise<BankVerificationResult> {
    const url = process.env.BANK_VERIFIER_URL;
    if (!url) throw new Error("Set BANK_VERIFIER_URL to use the HTTP bank verifier.");

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Bank verifier returned HTTP ${res.status}`);

    const body = (await res.json()) as Partial<BankVerificationResult>;
    if (body.status !== "confirmed" && body.status !== "mismatch" && body.status !== "unavailable") {
      throw new Error("Bank verifier returned an unrecognised verdict");
    }
    return {
      status: body.status,
      reference: body.reference,
      observed: body.observed,
      reasons: body.reasons,
    };
  },
};

const providers: Record<string, BankVerifier> = {
  mock: mockBankVerifier,
  http: httpVerifier,
};

export function bankVerifier(): BankVerifier {
  const key = (process.env.BANK_VERIFIER ?? "mock").trim().toLowerCase();
  const verifier = providers[key];
  if (!verifier) throw new Error(`Unknown BANK_VERIFIER "${key}" (expected mock or http).`);
  return verifier;
}
