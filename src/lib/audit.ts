import { DOCUMENT_LABELS, STATUS_LABELS, RELEASE_STATUS_LABELS } from "./labels";
import type { AuditLog, DepositStatus, DocumentType, ReleaseStatus } from "./types";

export const ENTITY_LABELS: Record<string, string> = {
  deposits: "Deposit",
  deposit_documents: "Document",
  discrepancies: "Discrepancy flag",
  comments: "Comment",
  release_requests: "Release request",
  deposit_demands: "Deposit demand",
  institutions: "Institution",
  profiles: "User",
  app_settings: "Settings",
  session: "Session",
};

export const ACTION_LABELS: Record<string, string> = {
  insert: "Created",
  update: "Updated",
  delete: "Deleted",
  status_change: "Status change",
  login: "Signed in",
  logout: "Signed out",
  "document.view": "Viewed document",
  "report.export": "Exported report",
  "user.create": "Created user",
};

type Changes = Record<string, unknown> & { status?: { from: string; to: string } };

function statusLabel(entity: string, s: string | undefined) {
  if (!s) return "—";
  if (entity === "release_requests") return RELEASE_STATUS_LABELS[s as ReleaseStatus] ?? s;
  return STATUS_LABELS[s as DepositStatus] ?? s;
}

/** Human-readable one-liner for an audit entry. */
export function describeAudit(log: AuditLog): string {
  const entity = ENTITY_LABELS[log.entity_type] ?? log.entity_type;
  const c = (log.changes ?? {}) as Changes;
  const note = log.summary?.includes(" — ") ? ` — ${log.summary.split(" — ").slice(1).join(" — ")}` : "";

  if (log.action === "status_change" && c.status) {
    return `${entity}: ${statusLabel(log.entity_type, c.status.from)} → ${statusLabel(log.entity_type, c.status.to)}${note}`;
  }
  if (log.entity_type === "deposit_documents" && (log.action === "insert" || log.action === "delete")) {
    const type = DOCUMENT_LABELS[c.doc_type as DocumentType] ?? "Document";
    const v = c.version ? ` v${c.version}` : "";
    return `${log.action === "insert" ? "Uploaded" : "Removed"} ${type}${v}: ${String(c.file_name ?? "")}`;
  }
  if (log.entity_type === "comments" && log.action === "insert") {
    const body = String(c.body ?? "");
    return `Comment: “${body.length > 120 ? `${body.slice(0, 117)}…` : body}”`;
  }
  if (log.entity_type === "discrepancies" && log.action === "insert") {
    return `Flag raised: ${String(c.message ?? c.code ?? "")}`;
  }
  if (log.entity_type === "discrepancies" && log.action === "update" && "resolved_at" in c) {
    return `Flag resolved${note}`;
  }
  if (log.entity_type === "session" || !(log.action in { insert: 1, update: 1, delete: 1 })) {
    return `${ACTION_LABELS[log.action] ?? log.action}${log.summary ? `: ${log.summary}` : ""}`;
  }
  return `${entity} ${log.summary ? log.summary.charAt(0).toLowerCase() + log.summary.slice(1) : ACTION_LABELS[log.action]}`;
}
