import type { Metadata } from "next";
import Link from "next/link";
import { requireUser, isOfficial } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatINR } from "@/lib/format";
import { RELEASE_REASON_LABELS, RELEASE_STATUS_LABELS } from "@/lib/labels";
import { pageRange, param, searchTerm } from "@/lib/query";
import type { ReleaseOverview, ReleaseStatus } from "@/lib/types";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ReleaseStatusBadge } from "@/components/badges";
import { FilterBar, FilterSelect, Pagination } from "@/components/list-controls";

export const metadata: Metadata = { title: "Release requests" };

export default async function ReleasesPage({ searchParams }: PageProps<"/releases">) {
  const params = await searchParams;
  const user = await requireUser();
  const official = isOfficial(user.role);
  const supabase = await createClient();

  const q = searchTerm(params.q);
  const status = param(params.status);
  const { page, from, to } = pageRange(params.page);

  let query = supabase.from("release_overview").select("*", { count: "exact" });
  if (q) {
    query = query.or(
      ["reference_no", "deposit_reference_no", "instrument_number", "institution_name", "institution_aicte_id"]
        .map((c) => `${c}.ilike.*${q}*`)
        .join(","),
    );
  }
  if (status in RELEASE_STATUS_LABELS) query = query.eq("status", status as ReleaseStatus);
  const { data, count } = await query
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, to);
  const rows = (data ?? []) as ReleaseOverview[];

  return (
    <>
      <PageHeader
        title="Release requests"
        description={
          official
            ? "Applications to release or refund security deposits. Approve once closure / completion is established and the affidavit is on record."
            : "Requests to release your deposits. Start one from a verified deposit’s page."
        }
      />
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
                  <th>Request</th>
                  {official && <th>Institution</th>}
                  <th>Deposit</th>
                  <th className="text-right">Amount</th>
                  <th>Reason</th>
                  <th>Submitted</th>
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
                    {official && <td className="max-w-56 truncate">{r.institution_name}</td>}
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
                    <td className="num whitespace-nowrap">{formatDate(r.submitted_at)}</td>
                    <td>
                      <ReleaseStatusBadge status={r.status} />
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
