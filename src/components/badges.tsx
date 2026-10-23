import { Badge, type Tone } from "./ui";
import {
  BANK_CHECK_LABELS,
  CLEARANCE_STATUS_LABELS,
  DEMAND_STATUS_LABELS,
  RELEASE_STATUS_LABELS,
  STATUS_LABELS,
  VALIDITY_LABELS,
} from "@/lib/labels";
import type {
  BankCheck,
  ClearanceStatus,
  DemandStatus,
  DepositStatus,
  ReleaseStatus,
  Validity,
} from "@/lib/types";

const STATUS_TONES: Record<DepositStatus, Tone> = {
  draft: "slate",
  submitted: "blue",
  discrepancy: "amber",
  verified: "green",
  rejected: "red",
  release_requested: "violet",
  released: "teal",
  replaced: "slate",
};

export function StatusBadge({ status }: { status: DepositStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function ValidityBadge({ validity, days }: { validity: Validity | null; days?: number }) {
  if (!validity) return null;
  const tone: Tone = validity === "active" ? "green" : validity === "maturing" ? "amber" : "red";
  return (
    <Badge tone={tone}>
      {VALIDITY_LABELS[validity]}
      {validity === "maturing" && days !== undefined && <span className="num">· {days}d</span>}
    </Badge>
  );
}

export function ReleaseStatusBadge({ status }: { status: ReleaseStatus }) {
  const tone: Tone = { draft: "slate", submitted: "blue", approved: "green", rejected: "red", withdrawn: "slate" }[
    status
  ] as Tone;
  return <Badge tone={tone}>{RELEASE_STATUS_LABELS[status]}</Badge>;
}

export function ClearanceStatusBadge({ status }: { status: ClearanceStatus }) {
  const tone: Tone = { pending: "amber", cleared: "green", blocked: "red" }[status] as Tone;
  return <Badge tone={tone}>{CLEARANCE_STATUS_LABELS[status]}</Badge>;
}

export function DemandStatusBadge({ status, overdue }: { status: DemandStatus; overdue?: boolean }) {
  if (overdue) return <Badge tone="red">Overdue</Badge>;
  const tone: Tone = { open: "blue", fulfilled: "green", waived: "slate" }[status] as Tone;
  return <Badge tone={tone}>{DEMAND_STATUS_LABELS[status]}</Badge>;
}

export function BankCheckBadge({ status }: { status: BankCheck }) {
  const tone: Tone = { not_requested: "slate", requested: "blue", confirmed: "green", mismatch: "red" }[
    status
  ] as Tone;
  return <Badge tone={tone}>{BANK_CHECK_LABELS[status]}</Badge>;
}

export function SeverityBadge({ severity }: { severity: "blocker" | "error" | "warning" | "info" | "critical" }) {
  const map: Record<string, [Tone, string]> = {
    blocker: ["red", "Blocking"],
    error: ["red", "Flag"],
    critical: ["red", "Critical"],
    warning: ["amber", "Warning"],
    info: ["blue", "Info"],
  };
  const [tone, label] = map[severity];
  return <Badge tone={tone}>{label}</Badge>;
}
