import type {
  AppRole,
  BankCheck,
  ClearanceCell,
  ClearanceStatus,
  DemandStatus,
  DepositStatus,
  DocumentType,
  InstrumentType,
  Region,
  ReleaseReason,
  ReleaseStatus,
  Validity,
} from "./types";

export const ROLE_LABELS: Record<AppRole, string> = {
  institute_user: "Institute Accounts Officer",
  regional_officer: "Regional Officer",
  aicte_verifier: "AICTE Verifier",
  release_officer: "Release Clearance Officer",
  admin: "Administrator",
};

export const CLEARANCE_CELL_LABELS: Record<ClearanceCell, string> = {
  grievance: "Grievance",
  vigilance: "Vigilance",
  pgrc: "PGRC",
};

export const CLEARANCE_CELL_DESCRIPTIONS: Record<ClearanceCell, string> = {
  grievance: "Grievance redressal cell",
  vigilance: "Vigilance cell",
  pgrc: "Programme Review & Closure Committee",
};

export const CLEARANCE_STATUS_LABELS: Record<ClearanceStatus, string> = {
  pending: "Pending",
  cleared: "Cleared",
  blocked: "Blocked",
};

export const REGION_LABELS: Record<Region, string> = {
  central: "Central (Bhopal)",
  eastern: "Eastern (Kolkata)",
  northern: "Northern (Kanpur)",
  north_western: "North-Western (Chandigarh)",
  southern: "Southern (Chennai)",
  south_central: "South-Central (Hyderabad)",
  south_western: "South-Western (Bengaluru)",
  western: "Western (Mumbai)",
};

export const INSTRUMENT_LABELS: Record<InstrumentType, string> = {
  fdr: "Fixed Deposit Receipt (FDR)",
  jfdr: "Joint FDR (in favour of AICTE)",
  bank_guarantee: "Bank Guarantee",
  demand_draft: "Demand Draft",
};

export const INSTRUMENT_SHORT: Record<InstrumentType, string> = {
  fdr: "FDR",
  jfdr: "JFDR",
  bank_guarantee: "BG",
  demand_draft: "DD",
};

export const STATUS_LABELS: Record<DepositStatus, string> = {
  draft: "Draft",
  submitted: "Pending verification",
  discrepancy: "Returned",
  verified: "Verified",
  rejected: "Rejected",
  release_requested: "Release requested",
  released: "Released",
  replaced: "Replaced",
};

export const VALIDITY_LABELS: Record<Validity, string> = {
  active: "Active",
  maturing: "Maturing soon",
  expired: "Expired",
};

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  fdr_scan: "Scanned FDR / instrument",
  affidavit: "Affidavit",
  loa: "LOI / LOA",
  payment_receipt: "Payment receipt",
  bank_certificate: "Bank certificate",
  clearance_certificate: "Clearance certificate",
  release_letter: "Release application letter",
  other: "Other",
};

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  draft: "Draft",
  submitted: "Under review",
  pending_second_approval: "Second approval due",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const RELEASE_REASON_LABELS: Record<ReleaseReason, string> = {
  course_closure: "Closure of course / programme",
  institution_closure: "Closure of institution",
  term_completion: "Completion of deposit term",
  replacement: "Replaced by another instrument",
  other: "Other",
};

export const QUOTE_REASON_LABELS: Record<string, string> = {
  EARLY_RELEASE_BEFORE_MIN_HOLDING: "Released before the minimum holding period",
  DEPOSIT_BELOW_REQUIRED: "Deposit is below the amount demanded",
  INSTRUMENT_ALREADY_MATURED: "Instrument has already matured",
};

export const DEMAND_STATUS_LABELS: Record<DemandStatus, string> = {
  open: "Open",
  fulfilled: "Fulfilled",
  waived: "Waived",
};

export const BANK_CHECK_LABELS: Record<BankCheck, string> = {
  not_requested: "Not requested",
  requested: "Requested from bank",
  confirmed: "Confirmed by bank",
  mismatch: "Mismatch reported",
};
