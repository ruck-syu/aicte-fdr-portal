import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser, isOfficial } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatINR } from "@/lib/format";
import { CLEARANCE_CELL_LABELS, RELEASE_REASON_LABELS, RELEASE_STATUS_LABELS } from "@/lib/labels";
import { pageRange, param, searchTerm, withParams } from "@/lib/query";
import type { ReleaseOverview, ReleaseStatus } from "@/lib/types";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { AgeBadge, ReleaseStatusBadge } from "@/components/badges";
import { FilterBar, FilterSelect, Pagination } from "@/components/list-controls";
import { PrintButton } from "@/components/print-button";
import { PrintMeta } from "@/components/print-meta";
import { SortLink } from "@/components/sort-link";

export const metadata: Metadata = { title: "Release requests" };

const SORT_FIELDS = {
  reference: "reference_no",
  amount: "amount",
  submitted: "submitted_at",
} as const;
type SortKey = keyof typeof SORT_FIELDS;
const ASC_BY_DEFAULT: SortKey[] = ["reference", "submitted"];

export default async function ReleasesPage({ searchParams }: PageProps<"/releases">) {
  const params = await searchParams;
  const user = await requireUser();
  const official = isOfficial(user.role);
  const supabase = await createClient();

  const q = searchTerm(params.q);
  const status = param(params.status);
  const requestedSort = param(params.sort);
  const sort: SortKey = requestedSort in SORT_FIELDS ? (requestedSort as SortKey) : "submitted";
  const requestedDir = param(params.dir);
  const dir: "asc" | "desc" =
    requestedDir === "asc" || requestedDir === "desc"
      ? requestedDir
      : ASC_BY_DEFAULT.includes(sort)
        ? "asc"
        : "desc";
  const sortHref = (key: SortKey) => {
    const nextDir = sort === key ? (dir === "asc" ? "desc" : "asc") : ASC_BY_DEFAULT.includes(key) ? "asc" : "desc";
    return `/releases${withParams(params, { sort: key, dir: nextDir, page: null })}`;
  };
  const { page, from, to } = pageRange(params.page);

  // A clearance officer can jump straight to the releases waiting on their cell.
  const cell = user.role === "release_officer" ? user.clearance_cell : null;
  const awaitingMine = param(params.awaiting) === "me" && !!cell;
  let mine: string[] = [];
  if (awaitingMine && cell) {
    const { data: pending } = await supabase
      .from("release_clearances")
      .select("release_request_id")
      .eq("cell", cell)
      .eq("status", "pending");
    mine = [...new Set(((pending ?? []) as { release_request_id: string }[]).map((c) => c.release_request_id))];
  }

  let query = supabase.from("release_overview").select("*", { count: "exact" });
  if (q) {
    query = query.or(
      ["reference_no", "deposit_reference_no", "instrument_number", "institution_name", "institution_aicte_id"]
        .map((c) => `${c}.ilike.*${q}*`)
        .join(","),
    );
  }
  if (awaitingMine) {
    // The cell queue is always "under review"; an empty set must still match nothing.
    query = query.eq("status", "submitted").in("id", mine.length ? mine : ["00000000-0000-0000-0000-000000000000"]);
  } else if (status in RELEASE_STATUS_LABELS) {
    query = query.eq("status", status as ReleaseStatus);
  }
  const { data, count } = await query
    .order(SORT_FIELDS[sort], { ascending: dir === "asc", nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);
  const rows = (data ?? []) as ReleaseOverview[];

  // Clearance progress for the rows on this page. Institutions read statuses on
  // the detail page; the table only holds official-readable rows.
  const progress = new Map<string, { cleared: number; blocked: number; total: number }>();
  if (official && rows.length) {
    const { data: clearances } = await supabase
      .from("release_clearances")
      .select("release_request_id, status")
      .in("release_request_id", rows.map((r) => r.id));
    for (const c of (clearances ?? []) as { release_request_id: string; status: string }[]) {
      const p = progress.get(c.release_request_id) ?? { cleared: 0, blocked: 0, total: 0 };
      p.total += 1;
      if (c.status === "cleared") p.cleared += 1;
      else if (c.status === "blocked") p.blocked += 1;
      progress.set(c.release_request_id, p);
    }
  }

  const statusLabel = status in RELEASE_STATUS_LABELS ? RELEASE_STATUS_LABELS[status as ReleaseStatus] : null;
  const filterSummary = [
    q && `search “${q}”`,
    awaitingMine && "my cell's queue",
    statusLabel && `${statusLabel} only`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PrintMeta label={`Release requests · page ${page}${filterSummary ? ` · ${filterSummary}` : ""}`} />
      <PageHeader
        title="Release requests"
        description={
          official
            ? "Applications to release or refund security deposits. Approve once closure / completion is established and the affidavit is on record."
            : "Requests to release your deposits. Start one from a verified deposit’s page."
        }
        actions={
          <>
            <PrintButton summary={`Release requests · page ${page} · ${filterSummary}`} />
            {official && (
              <a
                href={`/api/reports/releases${withParams(params, { page: null })}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50"
              >
                <Download className="size-4" /> Export CSV
              </a>
            )}
          </>
        }
      />
      {user.role === "release_officer" && cell && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <LinkButton
            href={`/releases${withParams(params, { awaiting: awaitingMine ? null : "me", status: null, page: null })}`}
            variant={awaitingMine ? "primary" : "secondary"}
            size="sm"
          >
            {awaitingMine ? "Show all releases" : "Only my cell's queue"}
          </LinkButton>
          <span className="text-xs text-slate-500">
            {awaitingMine
              ? `${CLEARANCE_CELL_LABELS[cell]} clearances awaiting your sign-off`
              : "Releases waiting on Grievance, Vigilance or PGRC sign-off."}
          </span>
        </div>
      )}
      <FilterBar action="/releases" q={q} placeholder="Reference, deposit, instrument, institution…" resetHref="/releases">
        <FilterSelect
          name="status"
          label="Status"
          value={status}
          options={Object.entries(RELEASE_STATUS_LABELS) as [string, string][]}
        />
      </FilterBar>
      <Card bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState title="No release requests" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th aria-sort={sort === "reference" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                    <SortLink label="Request" href={sortHref("reference")} active={sort === "reference"} dir={dir} />
                  </th>
                  {official && <th>Institution</th>}
                  <th>Deposit</th>
                  <th
                    className="text-right"
                    aria-sort={sort === "amount" ? (dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <SortLink
                      label="Amount"
                      href={sortHref("amount")}
                      active={sort === "amount"}
                      dir={dir}
                      align="right"
                    />
                  </th>
                  <th>Reason</th>
                  <th aria-sort={sort === "submitted" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                    <SortLink
                      label="Submitted"
                      href={sortHref("submitted")}
                      active={sort === "submitted"}
                      dir={dir}
                    />
                  </th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/releases/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.reference_no}
                      </Link>
                    </td>
                    {official && (
                      <td className="max-w-56 truncate">
                        <Link href={`/institutions/${r.institution_id}`} className="hover:text-brand-700 hover:underline">
                          {r.institution_name}
                        </Link>
                      </td>
                    )}
                    <td>
                      <Link href={`/deposits/${r.deposit_id}`} className="hover:underline">
                        {r.deposit_reference_no}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {r.instrument_number} · {r.bank_name}
                      </div>
                    </td>
                    <td className="num text-right">{formatINR(r.amount)}</td>
                    <td>{RELEASE_REASON_LABELS[r.reason]}</td>
                    <td className="whitespace-nowrap">
                      <div className="num">{formatDate(r.submitted_at)}</div>
                      {r.status === "submitted" && <AgeBadge since={r.submitted_at} label="Waiting" className="mt-1" />}
                    </td>
                    <td>
                      <ReleaseStatusBadge status={r.status} />
                      {r.status === "pending_second_approval" && (
                        <AgeBadge since={r.first_approved_at} label="Waiting" className="mt-1" />
                      )}
                      {(() => {
                        const p = progress.get(r.id);
                        if (!p?.total) return null;
                        const tone = p.blocked
                          ? "text-red-700"
                          : p.cleared === p.total
                            ? "text-emerald-700"
                            : "text-slate-500";
                        return (
                          <div className={`mt-1 text-xs ${tone}`}>
                            Clearances {p.cleared}/{p.total}
                            {p.blocked ? " · blocked" : ""}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath="/releases" params={params} page={page} total={count ?? 0} />
      </Card>
    </>
  );
}
