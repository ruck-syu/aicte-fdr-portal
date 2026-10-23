export type BankVerdictStatus = "confirmed" | "mismatch" | "unavailable";

export type BankVerificationInput = {
  bankName: string;
  ifsc: string | null;
  instrumentNumber: string;
  amount: number;
  maturityDate: string;
};

export type BankVerificationResult = {
  status: BankVerdictStatus;
  /** Bank's reference for a confirmed instrument. */
  reference?: string;
  /** What the bank says it holds, for the evidence record. */
  observed?: Record<string, unknown>;
  reasons?: string[];
};

export interface BankVerifier {
  /** Stable id stored on every evidence row. */
  readonly name: string;
  verify(input: BankVerificationInput): Promise<BankVerificationResult>;
}
