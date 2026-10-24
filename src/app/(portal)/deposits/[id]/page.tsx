import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleAlert, FileText, History, Pencil, RefreshCw } from "lucide-react";
import { requireUser, isReadOnly, isReviewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { describeAudit } from "@/lib/audit";
import { daysLabel, displayName, formatBytes, formatDate, formatDateTime, formatINR } from "@/lib/format";
import {
  DOCUMENT_LABELS,
  INSTRUMENT_LABELS,
  RELEASE_REASON_LABELS,
  ROLE_LABELS,
} from "@/lib/labels";
import type {
  AppSettings,
  AuditLog,
  Check,
  Comment,
  DepositDocument,
  DepositOverview,
  Discrepancy,
  DocumentType,
  ReleaseRequest,
} from "@/lib/types";
import { Alert, Badge, Card, DescriptionList, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { BankCheckBadge, ReleaseStatusBadge, SeverityBadge, StatusBadge, ValidityBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { DocumentUploader } from "@/components/document-uploader";
import { CommentThread } from "@/components/comment-thread";
import { PrintButton } from "@/components/print-button";
import { PrintMeta } from "@/components/print-meta";
import {
  deleteDeposit,
  requestRelease,
  resolveDiscrepancy,
  reviewDeposit,
  setArchived,
  setBankCheck,
  submitDeposit,
  verifyWithBank,
} from "../actions";
import { deleteDocument } from "../../documents/actions";

export const metadata: Metadata = { title: "Deposit" };

type DocRow = DepositDocument & { uploader: { full_name: string | null; email: string } | null };
type FlagRow = Discrepancy & { raiser: { full_name: string | null; email: string } | null };

export default async function DepositPage({ params, searchParams }: PageProps<"/deposits/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const supabase = await createClient();

  const { data: depositData } = await supabase.from("deposit_overview").select("*").eq("id", id).maybeSingle();
  if (!depositData) notFound();
  const d = depositData as DepositOverview;

  const [checksRes, flagsRes, docsRes, commentsRes, releasesRes, auditRes, successorsRes, settingsRes, reviewerRes] =
    await Promise.all([
      supabase.rpc("deposit_checks", { p_deposit: id }),
      supabase
        .from("discrepancies")
        .select("*, raiser:profiles!discrepancies_raised_by_fkey(full_name, email)")
        .eq("deposit_id", id)
        .order("resolved_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: false }),
      supabase
        .from("deposit_documents")
        .select("*, uploader:profiles!deposit_documents_uploaded_by_fkey(full_name, email)")
        .eq("deposit_id", id)
        .is("release_request_id", null)
        .order("doc_type")
        .order("version", { ascending: false }),
      supabase
        .from("comments")
        .select("*, author:profiles!comments_author_id_fkey(full_name, email, role)")
        .eq("deposit_id", id)
        .is("release_request_id", null)
        .order("created_at"),
      supabase.from("release_requests").select("*").eq("deposit_id", id).order("created_at", { ascending: false }),
      supabase.from("audit_logs").select("*").eq("deposit_id", id).order("occurred_at", { ascending: false }).limit(40),
      supabase
        .from("deposits")
        .select("id, reference_no, status, maturity_date, created_at")
        .eq("replaces_deposit_id", id)
        .order("created_at"),
      supabase.from("app_settings").select("*").maybeSingle(),
      d.verified_by
        ? supabase.from("profiles").select("full_name, email").eq("id", d.verified_by).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const checks = (checksRes.data ?? []) as Check[];
  const flags = (flagsRes.data ?? []) as FlagRow[];
  const docs = (docsRes.data ?? []) as DocRow[];
  const comments = (commentsRes.data ?? []) as Comment[];
  const releases = (releasesRes.data ?? []) as ReleaseRequest[];
  const audit = (auditRes.data ?? []) as AuditLog[];
  const successors = (successorsRes.data ?? []) as { id: string; reference_no: string; status: DepositOverview["status"]; maturity_date: string }[];
  const settings = settingsRes.data as AppSettings | null;
  const verifier = reviewerRes.data as { full_name: string | null; email: string } | null;

  // Walk back through the renewal chain (bounded).
  const predecessors: { id: string; reference_no: string; status: DepositOverview["status"]; maturity_date: string }[] = [];
  let prevId = d.replaces_deposit_id;
  for (let i = 0; prevId && i < 10; i++) {
    const { data: p } = await supabase
      .from("deposits")
      .select("id, reference_no, status, maturity_date, replaces_deposit_id")
      .eq("id", prevId)
      .maybeSingle();
    if (!p) break;
    predecessors.unshift(p);
    prevId = p.replaces_deposit_id;
  }

  const isOwner = user.role === "institute_user" && user.institution_id === d.institution_id;
  const editable = isOwner && (d.status === "draft" || d.status === "discrepancy");
  const blockers = checks.filter((c) => c.severity === "blocker");
  const openFlags = flags.filter((f) => !f.resolved_at);
  const openErrors = openFlags.filter((f) => f.severity === "error");
  const canReview = isReviewer(user.role) && d.status === "submitted";
  const activeRenewal = successors.find((s) => !["rejected", "replaced"].includes(s.status));
  const canRenew = isOwner && ["verified", "release_requested"].includes(d.status) && !activeRenewal;
  const openRelease = releases.find((r) => r.status === "draft" || r.status === "submitted");
  const canRequestRelease = isOwner && d.status === "verified" && !openRelease;

  const requiredDocs = settings?.required_documents ?? (["fdr_scan", "affidavit", "loa"] as DocumentType[]);
  const currentDocs = docs.filter((x) => x.is_current);
  const docTypes: DocumentType[] = [
    ...requiredDocs,
    ...(["fdr_scan", "affidavit", "loa", "payment_receipt", "bank_certificate", "other"] as DocumentType[]).filter(
      (t) => !requiredDocs.includes(t),
    ),
  ];
  const missingDocs = requiredDocs.filter((t) => !currentDocs.some((x) => x.doc_type === t));

  return (
    <>
      <PrintMeta label={`Deposit ${d.reference_no}`} />
      <PageHeader
        eyebrow={
          <Link href="/deposits" className="hover:underline">
            Deposits
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {d.reference_no}
            <StatusBadge status={d.status} />
            <ValidityBadge validity={d.validity} days={d.days_to_maturity} />
          </span>
        }
        description={
          <>
            {d.institution_name} ({d.institution_aicte_id}) · {INSTRUMENT_LABELS[d.instrument_type]}{" "}
            <span className="num">{d.instrument_number}</span>
          </>
        }
        actions={
          <>
            <PrintButton summary={`Deposit ${d.reference_no} · ${d.institution_name}`} />
            {editable && (
              <LinkButton href={`/deposits/${d.id}/edit`} variant="secondary">
                <Pencil className="size-4" /> Edit details
              </LinkButton>
            )}
            {canRenew && (
              <LinkButton href={`/deposits/new?renews=${d.id}`} variant="secondary">
                <RefreshCw className="size-4" /> Submit renewal
              </LinkButton>
            )}
            {editable && (
              <ActionForm action={submitDeposit} hideOk>
                <input type="hidden" name="id" value={d.id} />
                <SubmitButton>{d.status === "discrepancy" ? "Resubmit for verification" : "Submit for verification"}</SubmitButton>
              </ActionForm>
            )}
          </>
        }
      />

      <div className="space-y-3">
        {d.archived_at && (
          <Alert tone="blue" title="Archived record">
            This deposit passed its retention window and was archived on {formatDate(d.archived_at)}. It stays readable as
            evidence; an administrator can restore it if it has to change again.
          </Alert>
        )}
        {sp.created && (
          <Alert tone="green" title="Draft saved">
            Upload the required documents below, then submit the deposit for verification.
          </Alert>
        )}
        {d.status === "discrepancy" && isOwner && (
          <Alert tone="amber" title="Returned by the reviewing officer">
            Address the flags below (edit details or upload corrected documents), then resubmit.
          </Alert>
        )}
        {activeRenewal && (
          <Alert tone="blue">
            Renewal{" "}
            <Link className="font-medium underline" href={`/deposits/${activeRenewal.id}`}>
              {activeRenewal.reference_no}
            </Link>{" "}
            is in progress ({activeRenewal.status.replace("_", " ")}).
          </Alert>
        )}
        {d.status === "replaced" && successors[0] && (
          <Alert tone="blue">
            Replaced by{" "}
            <Link className="font-medium underline" href={`/deposits/${successors.at(-1)!.id}`}>
              {successors.at(-1)!.reference_no}
            </Link>
            .
          </Alert>
        )}
        {d.validity === "expired" && (
          <Alert tone="red" title="Instrument has matured">
            Matured {daysLabel(d.days_to_maturity)}. {isOwner ? "Submit a renewed instrument immediately." : "Pending renewal from the institution."}
          </Alert>
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Deposit details">
            <DescriptionList
              items={[
                { label: "Amount", value: <span className="num text-base font-semibold">{formatINR(d.amount)}</span> },
                { label: "Required amount", value: d.required_amount ? <span className="num">{formatINR(d.required_amount)}</span> : null },
                { label: "Interest rate", value: d.interest_rate ? `${d.interest_rate}% p.a.` : null },
                { label: "Issue date", value: formatDate(d.issue_date) },
                {
                  label: "Maturity date",
                  value: (
                    <>
                      {formatDate(d.maturity_date)}{" "}
                      {d.validity && <span className="text-xs text-slate-500">({daysLabel(d.days_to_maturity)})</span>}
                    </>
                  ),
                },
                { label: "Auto-renewal", value: d.auto_renewal ? "Yes" : "No" },
                { label: "Bank", value: d.bank_name },
                { label: "Branch", value: d.bank_branch },
                { label: "IFSC", value: d.ifsc },
                { label: "Approval case / LOA", value: d.approval_case_id },
                { label: "Programme", value: d.program },
                { label: "Approval valid until", value: d.approval_valid_until ? formatDate(d.approval_valid_until) : null },
                { label: "Submitted", value: d.submitted_at ? formatDateTime(d.submitted_at) : null },
                {
                  label: "Verified",
                  value: d.verified_at ? `${formatDateTime(d.verified_at)} by ${displayName(verifier)}` : null,
                },
                { label: "Bank confirmation", value: <BankCheckBadge status={d.bank_check} /> },
                ...(d.remarks ? [{ label: "Remarks", value: d.remarks, wide: true }] : []),
              ]}
            />
          </Card>

          <Card
            title="Compliance checks"
            description="Evaluated live against the approval terms, required documents and the existing register"
          >
            {checks.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" /> All checks pass.
              </p>
            ) : (
              <ul className="space-y-2">
                {checks.map((c, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    {c.severity === "warning" ? (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    ) : (
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
                    )}
                    <span className="flex-1 text-slate-800">{c.message}</span>
                    <SeverityBadge severity={c.severity} />
                  </li>
                ))}
              </ul>
            )}
            {editable && blockers.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">Blocking items must be fixed before the deposit can be submitted.</p>
            )}
          </Card>

          {flags.length > 0 && (
            <Card
              title={`Discrepancy flags (${openFlags.length} open)`}
              description="Raised automatically on submission, by bank verification or by the reviewing officer"
              bodyClassName="p-0"
            >
              <ul className="divide-y divide-slate-100">
                {flags.map((f) => (
                  <li key={f.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className={f.resolved_at ? "text-sm text-slate-500 line-through" : "text-sm text-slate-900"}>
                          {f.message}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {f.source === "officer" ? `Raised by ${displayName(f.raiser)}` : "System check"} ·{" "}
                          {formatDateTime(f.created_at)} · <span className="font-mono">{f.code}</span>
                        </p>
                        {f.resolved_at && (
                          <p className="mt-0.5 text-xs text-emerald-700">
                            Resolved {formatDateTime(f.resolved_at)}
                            {f.resolution_note && ` — ${f.resolution_note}`}
                          </p>
                        )}
                      </div>
                      {f.resolved_at ? <Badge tone="green">Resolved</Badge> : <SeverityBadge severity={f.severity} />}
                    </div>
                    {!f.resolved_at && canReview && (
                      <ActionForm action={resolveDiscrepancy} className="mt-2 flex flex-wrap gap-2" hideOk>
                        <input type="hidden" name="id" value={f.id} />
                        <input name="note" placeholder="Resolution note (optional)" className="input h-8 max-w-sm flex-1 py-1 text-xs" />
                        <SubmitButton size="sm" variant="secondary">
                          Mark resolved
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card
            title="Documents"
            description={
              missingDocs.length
                ? `Missing: ${missingDocs.map((t) => DOCUMENT_LABELS[t]).join(", ")}`
                : "All required documents uploaded"
            }
            bodyClassName="p-0"
          >
            {docs.length === 0 ? (
              <EmptyState title="No documents uploaded yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className={`flex flex-wrap items-center gap-3 px-5 py-3 ${doc.is_current ? "" : "bg-slate-50/60 text-slate-500"}`}
                  >
                    {doc.is_current ? (
                      <FileText className="size-4 shrink-0 text-brand-600" />
                    ) : (
                      <History className="size-4 shrink-0 text-slate-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium text-slate-900">{DOCUMENT_LABELS[doc.doc_type]}</span>
                        <Badge tone={doc.is_current ? "blue" : "slate"}>
                          v{doc.version}
                          {doc.is_current ? "" : " · superseded"}
                        </Badge>
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
                    {d.status === "draft" && doc.uploaded_by === user.id && (
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
            {(editable || (canReview && d.status === "submitted")) && (
              <div className="border-t border-slate-100 p-5">
                <DocumentUploader
                  institutionId={d.institution_id}
                  depositId={d.id}
                  docTypes={isReviewer(user.role) ? ["bank_certificate", "other"] : docTypes}
                  defaultType={isReviewer(user.role) ? "bank_certificate" : (missingDocs[0] ?? docTypes[0])}
                />
              </div>
            )}
          </Card>

          <Card title="Comments" description="Visible to the institution and reviewing officials">
            <CommentThread
              comments={comments}
              depositId={d.id}
              canComment={!isReadOnly(user.role) && d.status !== "released"}
            />
          </Card>
        </div>

        <div className="space-y-6">
          {user.role === "admin" &&
            (d.archived_at || ["released", "replaced", "rejected"].includes(d.status)) && (
              <Card
                title={d.archived_at ? "Archived record" : "Retention & archival"}
                description={
                  d.archived_at
                    ? "The record is frozen and readable. Restore it only if the evidence has to change."
                    : "Freeze this settled record. Nothing is deleted; the audit trail keeps it reachable."
                }
              >
                <ActionForm action={setArchived} hideOk>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="archived" value={d.archived_at ? "false" : "true"} />
                  <SubmitButton variant={d.archived_at ? "secondary" : "primary"} size="sm">
                    {d.archived_at ? "Restore record" : "Archive record"}
                  </SubmitButton>
                </ActionForm>
              </Card>
            )}
          {canReview && (
            <Card title="Verification decision" className="border-brand-200 ring-1 ring-brand-100">
              <ActionForm action={reviewDeposit} className="space-y-3">
                <input type="hidden" name="id" value={d.id} />
                {openErrors.length > 0 && (
                  <Alert tone="amber">
                    {openErrors.length} open flag{openErrors.length === 1 ? "" : "s"}. Resolve them, return to the
                    institution, or verify with an override note.
                  </Alert>
                )}
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Note to institution</span>
                  <textarea
                    name="note"
                    rows={3}
                    className="input"
                    placeholder="Required when returning, rejecting or overriding flags"
                  />
                </label>
                {openErrors.length > 0 && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" name="override" className="size-4 rounded border-slate-300" />
                    Override open flags
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="decision" value="verify" variant="success">
                    Verify
                  </SubmitButton>
                  <SubmitButton name="decision" value="return" variant="secondary">
                    Return to institution
                  </SubmitButton>
                  <SubmitButton
                    name="decision"
                    value="reject"
                    variant="danger"
                    confirm="Reject this deposit? The institution will need to register a new one."
                  >
                    Reject
                  </SubmitButton>
                </div>
              </ActionForm>
            </Card>
          )}

          {isReviewer(user.role) && !["draft", "rejected", "released", "replaced"].includes(d.status) && (
            <Card title="Bank verification" description="Ask the configured bank verifier, or record a confirmation manually">
              {["submitted", "discrepancy"].includes(d.status) && (
                <div className="mb-4 rounded-md border border-slate-200 bg-slate-50/60 p-3">
                  <ActionForm action={verifyWithBank} hideOk>
                    <input type="hidden" name="id" value={d.id} />
                    <SubmitButton size="sm">Verify with bank</SubmitButton>
                  </ActionForm>
                  <p className="mt-1.5 text-xs text-slate-500">
                    Calls the configured provider (mock by default) and stores the request and response as audit evidence.
                  </p>
                </div>
              )}
              <ActionForm action={setBankCheck} className="space-y-3">
                <input type="hidden" name="id" value={d.id} />
                <select name="bank_check" defaultValue={d.bank_check} className="input">
                  <option value="not_requested">Not requested</option>
                  <option value="requested">Requested from bank</option>
                  <option value="confirmed">Confirmed by bank</option>
                  <option value="mismatch">Mismatch reported (raises a flag)</option>
                </select>
                <input
                  name="ref"
                  defaultValue={d.bank_check_ref ?? ""}
                  placeholder="Bank letter / email reference"
                  className="input"
                />
                <SubmitButton variant="secondary" size="sm">
                  Update
                </SubmitButton>
              </ActionForm>
            </Card>
          )}

          {(predecessors.length > 0 || successors.length > 0) && (
            <Card title="Renewal history" description="Each renewal replaces the previous instrument" bodyClassName="p-0">
              <ol className="divide-y divide-slate-100">
                {[...predecessors, { id: d.id, reference_no: d.reference_no, status: d.status, maturity_date: d.maturity_date }, ...successors].map(
                  (x, i) => (
                    <li key={x.id} className={`flex items-center gap-3 px-5 py-2.5 ${x.id === d.id ? "bg-brand-50/60" : ""}`}>
                      <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs text-slate-600">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        {x.id === d.id ? (
                          <span className="font-medium">{x.reference_no} (this)</span>
                        ) : (
                          <Link href={`/deposits/${x.id}`} className="font-medium text-brand-700 hover:underline">
                            {x.reference_no}
                          </Link>
                        )}
                        <div className="text-xs text-slate-500">Matures {formatDate(x.maturity_date)}</div>
                      </div>
                      <StatusBadge status={x.status} />
                    </li>
                  ),
                )}
              </ol>
            </Card>
          )}

          {(releases.length > 0 || canRequestRelease) && (
            <Card title="Release / refund" bodyClassName="p-0">
              {releases.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {releases.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="text-sm">
                        <Link href={`/releases/${r.id}`} className="font-medium text-brand-700 hover:underline">
                          {r.reference_no}
                        </Link>
                        <div className="text-xs text-slate-500">{RELEASE_REASON_LABELS[r.reason]}</div>
                      </div>
                      <ReleaseStatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              )}
              {canRequestRelease && (
                <details className="border-t border-slate-100 px-5 py-4 first:border-t-0">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">Request release of this deposit</summary>
                  <ActionForm action={requestRelease} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={d.id} />
                    <select name="reason" className="input" required defaultValue="">
                      <option value="" disabled>
                        Reason for release…
                      </option>
                      {Object.entries(RELEASE_REASON_LABELS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <textarea name="details" rows={3} className="input" placeholder="Details (closure order no., dates…)" />
                    <SubmitButton size="sm">Start release request</SubmitButton>
                    <p className="text-xs text-slate-500">
                      You will then upload the release application and affidavit before submitting.
                    </p>
                  </ActionForm>
                </details>
              )}
            </Card>
          )}

          <Card title="Activity" description="From the tamper-evident audit trail" bodyClassName="p-0">
            {audit.length === 0 ? (
              <EmptyState title="No activity" />
            ) : (
              <ol className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
                {audit.map((a) => (
                  <li key={a.id} className="px-5 py-2.5 text-sm">
                    <p className="text-slate-800">{describeAudit(a)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {a.actor_email ?? "System"}
                      {a.actor_role && ` (${ROLE_LABELS[a.actor_role]})`} · {formatDateTime(a.occurred_at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {isOwner && d.status === "draft" && (
            <Card title="Delete draft">
              <ActionForm action={deleteDeposit} confirm="Delete this draft and its documents?">
                <input type="hidden" name="id" value={d.id} />
                <p className="mb-3 text-sm text-slate-600">Drafts that were never submitted can be deleted.</p>
                <SubmitButton variant="danger" size="sm">
                  Delete draft
                </SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
