export type AppRole = "institute_user" | "regional_officer" | "aicte_verifier" | "admin";
export type Region =
  | "central"
  | "eastern"
  | "northern"
  | "north_western"
  | "southern"
  | "south_central"
  | "south_western"
  | "western";
export type InstrumentType = "fdr" | "jfdr" | "bank_guarantee" | "demand_draft";
export type DepositStatus =
  | "draft"
  | "submitted"
  | "discrepancy"
  | "verified"
  | "rejected"
  | "release_requested"
  | "released"
  | "replaced";
export type Validity = "active" | "maturing" | "expired";
export type DocumentType =
  | "fdr_scan"
  | "affidavit"
  | "loa"
  | "payment_receipt"
  | "bank_certificate"
  | "clearance_certificate"
  | "release_letter"
  | "other";
export type ReleaseStatus = "draft" | "submitted" | "approved" | "rejected" | "withdrawn";
export type ReleaseReason =
  | "course_closure"
  | "institution_closure"
  | "term_completion"
  | "replacement"
  | "other";
export type DemandStatus = "open" | "fulfilled" | "waived";
export type BankCheck = "not_requested" | "requested" | "confirmed" | "mismatch";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  designation: string | null;
  role: AppRole | null;
  institution_id: string | null;
  region: Region | null;
  is_active: boolean;
  created_at: string;
}

export interface Institution {
  id: string;
  aicte_id: string;
  name: string;
  state: string;
  city: string | null;
  region: Region;
  address: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

export interface Deposit {
  id: string;
  reference_no: string;
  institution_id: string;
  demand_id: string | null;
  replaces_deposit_id: string | null;
  instrument_type: InstrumentType;
  instrument_number: string;
  bank_name: string;
  bank_branch: string | null;
  ifsc: string | null;
  amount: number;
  interest_rate: number | null;
  issue_date: string;
  maturity_date: string;
  auto_renewal: boolean;
  approval_case_id: string | null;
  program: string | null;
  approval_valid_until: string | null;
  required_amount: number | null;
  status: DepositStatus;
  bank_check: BankCheck;
  bank_check_ref: string | null;
  remarks: string | null;
  created_by: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepositOverview extends Deposit {
  institution_name: string;
  institution_aicte_id: string;
  region: Region;
  state: string;
  days_to_maturity: number;
  validity: Validity | null;
  open_errors: number;
  open_flags: number;
}

export interface Demand {
  id: string;
  reference_no: string;
  institution_id: string;
  approval_case_id: string;
  program: string | null;
  required_amount: number;
  approval_valid_until: string | null;
  intimation_date: string;
  due_date: string;
  status: DemandStatus;
  notes: string | null;
  created_at: string;
}

export interface DemandOverview extends Demand {
  institution_name: string;
  institution_aicte_id: string;
  region: Region;
  deposits_submitted: number;
  is_overdue: boolean;
}

export interface ReleaseRequest {
  id: string;
  reference_no: string;
  deposit_id: string;
  institution_id: string;
  reason: ReleaseReason;
  details: string | null;
  status: ReleaseStatus;
  requested_by: string | null;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface ReleaseOverview extends ReleaseRequest {
  deposit_reference_no: string;
  instrument_number: string;
  bank_name: string;
  amount: number;
  maturity_date: string;
  institution_name: string;
  institution_aicte_id: string;
  region: Region;
}

export interface DepositDocument {
  id: string;
  deposit_id: string | null;
  release_request_id: string | null;
  institution_id: string;
  doc_type: DocumentType;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  version: number;
  is_current: boolean;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface Discrepancy {
  id: string;
  deposit_id: string;
  code: string;
  severity: "error" | "warning";
  message: string;
  source: "system" | "officer";
  raised_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
}

export interface Check {
  code: string;
  severity: "blocker" | "error" | "warning";
  message: string;
}

export interface Comment {
  id: string;
  deposit_id: string | null;
  release_request_id: string | null;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: { full_name: string | null; email: string; role: AppRole | null } | null;
}

export interface AuditLog {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: AppRole | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  institution_id: string | null;
  deposit_id: string | null;
  summary: string | null;
  changes: Record<string, unknown> | null;
}

export interface Notification {
  id: string;
  institution_id: string | null;
  deposit_id: string | null;
  demand_id: string | null;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  created_at: string;
}

export interface AppSettings {
  alert_days: number[];
  escalation_days: number;
  submission_window_days: number;
  required_documents: DocumentType[];
  release_required_documents: DocumentType[];
}

export interface DashboardStats {
  held_count: number;
  held_value: number;
  active: number;
  maturing: number;
  expired: number;
  pending_verification: number;
  flagged: number;
  returned: number;
  drafts: number;
  release_pending: number;
  released_value: number;
  open_demands: number;
  overdue_demands: number;
  by_status: Partial<Record<DepositStatus, number>>;
  by_region: { region: Region; count: number; value: number }[];
  maturity_timeline: { month: string; count: number; value: number }[];
}

export type ActionState = { error?: string; ok?: string } | null;
