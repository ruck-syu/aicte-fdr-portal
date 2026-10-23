import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, History } from "lucide-react";
import { requireUser, isOfficial, canSignClearance } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { displayName, formatBytes, formatDate, formatDateTime, formatINR } from "@/lib/format";
import {
  CLEARANCE_CELL_DESCRIPTIONS,
  CLEARANCE_CELL_LABELS,
  DOCUMENT_LABELS,
  QUOTE_REASON_LABELS,
  RELEASE_REASON_LABELS,
} from "@/lib/labels";
import type {
  AppSettings,
  ClearanceCell,
  ClearanceStatus,
  Comment,
  DepositDocument,
  DocumentType,
  ReleaseOverview,
  ReleaseQuote,
} from "@/lib/types";
import { Alert, Badge, Card, DescriptionList, EmptyState, PageHeader } from "@/components/ui";
import { ClearanceStatusBadge, ReleaseStatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DocumentUploader } from "@/components/document-uploader";
import { CommentThread } from "@/components/comment-thread";
import { PrintButton } from "@/components/print-button";
import { PrintMeta } from "@/components/print-meta";
import { decideRelease, recordClearance, submitRelease, withdrawRelease } from "../actions";
import { deleteDocument } from "../../documents/actions";

export const metadata: Metadata = { title: "Release request" };

type DocRow = DepositDocument & { uploader: { full_name: string | null; email: string } | null };
/** Officials get the full row; institutions get the note-free summary. */
type ClearanceRow = {
  cell: ClearanceCell;
  status: ClearanceStatus;
  note?: string | null;
  decided_at?: string | null;
  officer?: { full_name: string | null; email: string } | null;
};

export default async function ReleasePage({ params }: PageProps<"/releases/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const official = isOfficial(user.role);
  const supabase = await createClient();

  const { data } = await supabase.from("release_overview").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const r = data as ReleaseOverview;

  const [docsRes, commentsRes, settingsRes, peopleRes, quoteRes, clearancesRes] = await Promise.all([
    supabase
      .from("deposit_documents")
      .select("*, uploader:profiles!deposit_documents_uploaded_by_fkey(full_name, email)")
      .eq("release_request_id", id)
      .order("doc_type")
      .order("version", { ascending: false }),
    supabase
      .from("comments")
      .select("*, author:profiles!comments_author_id_fkey(full_name, email, role)")
      .eq("release_request_id", id)
      .order("created_at"),
    supabase.from("app_settings").select("*").maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [r.requested_by, r.decided_by].filter(Boolean) as string[]),
    supabase.rpc("release_quote", { p_deposit: r.deposit_id }),
    official
      ? supabase
          .from("release_clearances")
          .select("*, officer:profiles!release_clearances_decided_by_fkey(full_name, email)")
          .eq("release_request_id", id)
      : supabase.rpc("release_clearance_summary", { p_release: id }),
  ]);
  const liveQuote = (quoteRes.data ?? null) as ReleaseQuote | null;
  // An approved release keeps the quote frozen at approval; never recompute it.
  const sanctionedQuote = r.quote ?? null;
  const breakdown = sanctionedQuote ?? liveQuote;
  const docs = (docsRes.data ?? []) as DocRow[];
  const comments = (commentsRes.data ?? []) as Comment[];
  const settings = settingsRes.data as AppSettings | null;
  const people = new Map((peopleRes.data ?? []).map((p) => [p.id, p]));
  const clearanceByCell = new Map(
    ((clearancesRes.data ?? []) as ClearanceRow[]).map((c) => [c.cell, c]),
  );
  const cells: ClearanceCell[] = ["grievance", "vigilance", "pgrc"];
  const clearedCount = cells.filter((c) => clearanceByCell.get(c)?.status === "cleared").length;
  const allDecided = cells.every((c) => (clearanceByCell.get(c)?.status ?? "pending") !== "pending");
  // An administrator may override a block (with a note), never a missing sign-off.
  const canApprove = clearedCount === cells.length || (user.role === "admin" && allDecided);
  const awaiting = cells.filter((c) => clearanceByCell.get(c)?.status !== "cleared");

  const isOwner = user.role === "institute_user" && user.institution_id === r.institution_id;
  const required = settings?.release_required_documents ?? (["release_letter", "affidavit"] as DocumentType[]);
  const missing = required.filter((t) => !docs.some((x) => x.is_current && x.doc_type === t));
  const docTypes: DocumentType[] = [
    ...required,
    ...(["clearance_certificate", "fdr_scan", "other"] as DocumentType[]).filter((t) => !required.includes(t)),
  ];

  return (
    <>
      <PrintMeta label={`Release ${r.reference_no}`} />
      <PageHeader
        eyebrow={
          <Link href="/releases" className="hover:underline">
            Release requests
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.reference_no} <ReleaseStatusBadge status={r.status} />
          </span>
        }
        description={
          <>
            Release of{" "}
            <Link href={`/deposits/${r.deposit_id}`} className="font-medium text-brand-700 hover:underline">
              {r.deposit_reference_no}
            </Link>{" "}
            · {r.institution_name}
          </>
        }
        actions={
          <>
            <PrintButton summary={`Release ${r.reference_no} · ${r.institution_name}`} />
            {isOwner && (r.status === "draft" || r.status === "submitted") ? (
              <>
                {r.status === "draft" && (
                  <ActionForm action={submitRelease} hideOk>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton>Submit for approval</SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={withdrawRelease} confirm="Withdraw this release request?" hideOk>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton variant="secondary">Withdraw</SubmitButton>
                </ActionForm>
              </>
            ) : null}
          </>
        }
      />

      {r.status === "draft" && isOwner && missing.length > 0 && (
        <div className="mb-4">
          <Alert tone="amber" title="Documents required before submission">
            Upload: {missing.map((t) => DOCUMENT_LABELS[t]).join(", ")}.
          </Alert>
        </div>
      )}
      {r.status === "approved" && (
        <div className="mb-4">
          <Alert tone="green" title="Release approved">
            Approved {formatDateTime(r.decided_at)} by {displayName(people.get(r.decided_by ?? ""))}. The deposit is
            recorded as released{r.sanctioned_amount !== null ? ` and ${formatINR(r.sanctioned_amount)} sanctioned` : ""}
            {r.noc_reference ? ` under NOC ${r.noc_reference}` : ""}.
          </Alert>
        </div>
      )}
      {r.status === "rejected" && (
        <div className="mb-4">
          <Alert tone="red" title="Release rejected">
            {r.decision_note}
          </Alert>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Request">
            <DescriptionList
              items={[
                { label: "Reason", value: RELEASE_REASON_LABELS[r.reason] },
                { label: "Requested by", value: displayName(people.get(r.requested_by ?? "")) },
                { label: "Submitted", value: r.submitted_at ? formatDateTime(r.submitted_at) : "Not yet submitted" },
                { label: "Deposit amount", value: <span className="num">{formatINR(r.amount)}</span> },
                { label: "Instrument", value: `${r.instrument_number} · ${r.bank_name}` },
                { label: "Maturity", value: formatDate(r.maturity_date) },
                { label: "Details", value: r.details, wide: true },
                ...(r.decided_at
                  ? [
                      { label: "Decided", value: `${formatDateTime(r.decided_at)} by ${displayName(people.get(r.decided_by ?? ""))}` },
                      { label: "Decision note", value: r.decision_note, wide: true },
                      ...(r.noc_reference ? [{ label: "NOC reference", value: r.noc_reference }] : []),
                    ]
                  : []),
              ]}
            />
          </Card>

          <Card
            title="Clearances"
            description="Grievance, Vigilance and PGRC each sign off before a release can be approved."
          >
            <ul className="space-y-3">
              {cells.map((cell) => {
                const c = clearanceByCell.get(cell);
                const status = c?.status ?? "pending";
                const signable = r.status === "submitted" && canSignClearance(user, cell);
                return (
                  <li key={cell} className="rounded-md border border-slate-200 px-3.5 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{CLEARANCE_CELL_LABELS[cell]}</div>
                        <div className="text-xs text-slate-500">{CLEARANCE_CELL_DESCRIPTIONS[cell]}</div>
                      </div>
                      <ClearanceStatusBadge status={status} />
                    </div>
                    {c?.decided_at && (
                      <p className="mt-1 text-xs text-slate-500">
                        {official && c.officer ? `${displayName(c.officer)} · ` : ""}
                        {formatDateTime(c.decided_at)}
                      </p>
                    )}
                    {official && c?.note && <p className="mt-1 text-xs text-slate-600">{c.note}</p>}
                    {signable && (
                      <ActionForm action={recordClearance} className="mt-3 space-y-2">
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="cell" value={cell} />
                        <input
                          name="note"
                          className="input"
                          placeholder={status === "blocked" ? "Reason for the block (required)" : "Note (optional)"}
                        />
                        <div className="flex flex-wrap gap-2">
                          <SubmitButton
                            size="sm"
                            name="status"
                            value="cleared"
                            variant="success"
                            confirm={`Record ${CLEARANCE_CELL_LABELS[cell]} clearance?`}
                          >
                            {status === "blocked" ? "Clear block" : "Clear"}
                          </SubmitButton>
                          <SubmitButton size="sm" name="status" value="blocked" variant="danger">
                            Block
                          </SubmitButton>
                        </div>
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card
            title="Supporting documents"
            description={`Required: ${required.map((t) => DOCUMENT_LABELS[t]).join(", ")}`}
            bodyClassName="p-0"
          >
            {docs.length === 0 ? (
              <EmptyState title="No documents uploaded yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {docs.map((doc) => (
                  <li key={doc.id} className={`flex items-center gap-3 px-5 py-3 ${doc.is_current ? "" : "bg-slate-50/60"}`}>
                    {doc.is_current ? (
                      <FileText className="size-4 shrink-0 text-brand-600" />
                    ) : (
                      <History className="size-4 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{DOCUMENT_LABELS[doc.doc_type]}</span>
                        <Badge tone={doc.is_current ? "blue" : "slate"}>v{doc.version}</Badge>
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {doc.file_name} · {formatBytes(doc.size_bytes)} · {displayName(doc.uploader)} ·{" "}
                        {formatDateTime(doc.uploaded_at)}
                      </div>
                    </div>
                    <a
                      href={`/api/documents/${doc.id}`}
                      target="_blank"
                      rel="noopener"
                      className="text-xs font-medium text-brand-700 hover:underline"
                    >
                      View
                    </a>
                    {r.status === "draft" && doc.uploaded_by === user.id && (
                      <ActionForm action={deleteDocument} confirm="Remove this document?" hideOk>
                        <input type="hidden" name="id" value={doc.id} />
                        <SubmitButton size="sm" variant="ghost">
                          Remove
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isOwner && r.status === "draft" && (
              <div className="border-t border-slate-100 p-5">
                <DocumentUploader
                  institutionId={r.institution_id}
                  releaseRequestId={r.id}
                  docTypes={docTypes}
                  defaultType={missing[0] ?? docTypes[0]}
                />
              </div>
            )}
          </Card>

          <Card title="Comments">
            <CommentThread comments={comments} releaseRequestId={r.id} canComment={r.status !== "withdrawn"} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card
            title={sanctionedQuote ? "Sanctioned refund" : "Refund estimate"}
            description={
              sanctionedQuote
                ? `Frozen when the release was approved on ${formatDate(r.sanctioned_at)}.`
                : "Indicative only — the final sanction rests with AICTE."
            }
          >
            {breakdown ? (
              <DescriptionList
                items={[
                  { label: "Principal", value: <span className="num">{formatINR(breakdown.principal)}</span> },
                  {
                    label: `Interest (${breakdown.interest_rate}% · ${breakdown.holding_days} days)`,
                    value: <span className="num">{formatINR(breakdown.accrued_interest)}</span>,
                  },
                  {
                    label: `Penalty (${breakdown.penalty_pct}%)`,
                    value: (
                      <span className={breakdown.penalty_amount > 0 ? "num text-red-700" : "num"}>
                        {formatINR(breakdown.penalty_amount)}
                      </span>
                    ),
                  },
                  {
                    label: sanctionedQuote ? "Sanctioned amount" : "Net payable",
                    value: (
                      <span className="num font-semibold">
                        {formatINR(sanctionedQuote ? r.sanctioned_amount : breakdown.net_payable)}
                      </span>
                    ),
                  },
                  ...(breakdown.shortfall > 0
                    ? [{ label: "Below demanded amount", value: <span className="num">{formatINR(breakdown.shortfall)}</span> }]
                    : []),
                  ...(breakdown.reasons.length > 0
                    ? [
                        {
                          label: "Notes",
                          value: breakdown.reasons.map((x) => QUOTE_REASON_LABELS[x] ?? x).join("; "),
                          wide: true,
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <EmptyState title="Estimate unavailable">
                The refund for this deposit cannot be computed right now.
              </EmptyState>
            )}
          </Card>
          {official && r.status === "submitted" && (
            <Card title="Decision" className="border-brand-200 ring-1 ring-brand-100">
              <ActionForm action={decideRelease} className="space-y-3">
                <input type="hidden" name="id" value={r.id} />
                <ul className="space-y-1 text-sm text-slate-600">
                  {required.map((t) => (
                    <li key={t}>
                      {docs.some((x) => x.is_current && x.doc_type === t) ? "✓" : "✗"} {DOCUMENT_LABELS[t]}
                    </li>
                  ))}
                  <li className={clearedCount === 3 ? "" : "text-slate-500"}>
                    {clearedCount === 3 ? "✓" : "✗"} Clearances ({clearedCount}/3)
                  </li>
                </ul>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">NOC reference</span>
                  <input name="noc_reference" className="input" placeholder="e.g. NOC/AICTE/2026/001" />
                  <span className="mt-1 block text-xs text-slate-500">Required to approve; stored on the release.</span>
                </label>
                <textarea
                  name="note"
                  rows={3}
                  className="input"
                  placeholder="Decision note (required to reject, or for an administrator override)"
                />
                <div className="flex flex-wrap gap-2">
                  {canApprove && (
                    <SubmitButton
                      name="decision"
                      value="approve"
                      variant="success"
                      confirm="Approve release? The deposit will be marked as released."
                    >
                      Approve release
                    </SubmitButton>
                  )}
                  <SubmitButton name="decision" value="reject" variant="danger">
                    Reject
                  </SubmitButton>
                </div>
                {!canApprove && (
                  <p className="text-xs text-amber-700">
                    Awaiting {awaiting.map((c) => CLEARANCE_CELL_LABELS[c]).join(", ")}. Approval unlocks once every cell has
                    cleared.
                  </p>
                )}
              </ActionForm>
            </Card>
          )}
          <Card title="Workflow">
            <ol className="space-y-3 text-sm">
              {[
                ["Draft prepared", true],
                ["Documents uploaded", missing.length === 0],
                ["Submitted for approval", !!r.submitted_at],
                [`Clearances (${clearedCount}/3)`, clearedCount === 3],
                [
                  r.status === "rejected" ? "Rejected" : r.status === "withdrawn" ? "Withdrawn" : "Approved & released",
                  ["approved", "rejected", "withdrawn"].includes(r.status),
                ],
              ].map(([label, done]) => (
                <li key={label as string} className="flex items-center gap-2.5">
                  <span
                    className={`grid size-5 place-items-center rounded-full text-[11px] ${done ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500"}`}
                  >
                    {done ? "✓" : ""}
                  </span>
                  <span className={done ? "text-slate-900" : "text-slate-500"}>{label as string}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
