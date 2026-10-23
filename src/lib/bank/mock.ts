import type { BankVerificationInput, BankVerificationResult, BankVerifier } from "./verifier";

/**
 * Deterministic, offline stand-in for a bank's verification API.
 *
 *   instrument number containing "ERR"  -> unavailable
 *   instrument number ending in 0 or 5  -> mismatch
 *   anything else                       -> confirmed with a generated reference
 *
 * No network, no credentials: the flow, the evidence table and the discrepancy
 * handling are real; only the bank is simulated.
 */
export const mockBankVerifier: BankVerifier = {
  name: "mock",

  async verify(input: BankVerificationInput): Promise<BankVerificationResult> {
    const number = input.instrumentNumber.trim().toUpperCase();

    if (number.includes("ERR")) {
      return { status: "unavailable", reasons: ["Mock bank host unreachable; retry later"] };
    }

    if (/[05]$/.test(number)) {
      return {
        status: "mismatch",
        observed: {
          amount: Math.max(input.amount - 1, 0),
          maturityDate: input.maturityDate,
        },
        reasons: ["Amount on the bank's record differs from the instrument"],
      };
    }

    return {
      status: "confirmed",
      reference: `MOCK/${new Date().getUTCFullYear()}/${number.slice(-6)}`,
      observed: {
        bankName: input.bankName,
        ifsc: input.ifsc,
        instrumentNumber: number,
        amount: input.amount,
        maturityDate: input.maturityDate,
      },
    };
  },
};
