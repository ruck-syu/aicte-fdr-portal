import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { requireUser, isOfficial } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatINR, daysLabel } from "@/lib/format";
import { INSTRUMENT_SHORT, INSTRUMENT_LABELS, REGION_LABELS, STATUS_LABELS, VALIDITY_LABELS } from "@/lib/labels";
import { pageRange, param, searchTerm, withParams } from "@/lib/query";
import type { DepositOverview, DepositStatus, InstrumentType, Region, Validity } from "@/lib/types";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { AgeBadge, StatusBadge, ValidityBadge } from "@/components/badges";
import { FilterBar, FilterSelect, Pagination } from "@/components/list-controls";

export const metadata: Metadata = { title: "Deposits" };

const STATUS_OPTIONS: [string, string][] = [
  ["held", "Held (verified + release requested)"],
  ...(Object.entries(STATUS_LABELS) as [string, string][]),
];

export default async function DepositsPage({ searchParams }: PageProps<"/deposits">) {
  const params = await searchParams;
  const user = await requireUser();
  const official = isOfficial(user.role);
  const supabase = await createClient();

  const q = searchTerm(params.q);
  const status = param(params.status);
  const validity = param(params.validity);
  const region = param(params.region);
  const instrument = param(params.instrument);
  const sort = param(params.sort);
  const { page, from, to } = pageRange(params.page);

  let query = supabase.from("deposit_overview").select("*", { count: "exact" });
  if (q) {
    query = query.or(
      ["reference_no", "instrument_number", "bank_name", "institution_name", "institution_aicte_id", "approval_case_id"]
        .map((c) => `${c}.ilike.*${q}*`)
        .join(","),
    );
  }
  if (status === "held") query = query.in("status", ["verified", "release_requested"]);
  else if (status in STATUS_LABELS) query = query.eq("status", status as DepositStatus);
  if (validity in VALIDITY_LABELS) query = query.eq("validity", validity as Validity);
  if (region in REGION_LABELS) query = query.eq("region", region as Region);
  if (instrument in INSTRUMENT_LABELS) query = query.eq("instrument_type", instrument as InstrumentType);
  query =
    sort === "maturity"
      ? query.order("maturity_date", { ascending: true })
      : sort === "amount"
        ? query.order("amount", { ascending: false })
        : query.order("updated_at", { ascending: false });

  const { data, count, error } = await query.range(from, to);
  const rows = (data ?? []) as DepositOverview[];

  return (
    <>
      <PageHeader
        title="Deposits"
        description={
          official
            ? "Central register of security deposits (FDRs, joint FDRs, bank guarantees) in your jurisdiction."
            : "Security deposit instruments registered by your institution."
        }
        actions={
          <>
            {official && (
              <a
                href={`/api/reports/deposits${withParams(params, { page: null })}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50"
              >
                <Download className="size-4" /> Export CSV
              </a>
            )}
            {user.role === "institute_user" && (
              <LinkButton href="/deposits/new">
                <Plus className="size-4" /> Register deposit
              </LinkButton>
            )}
          </>
        }
      />

      <FilterBar
        action="/deposits"
        q={q}
        placeholder="Reference, instrument no., bank, institution, approval case…"
        resetHref="/deposits"
      >
        <FilterSelect name="status" label="Status" value={status} options={STATUS_OPTIONS} />
        <FilterSelect
          name="validity"
          label="Validity"
          value={validity}
          options={Object.entries(VALIDITY_LABELS) as [string, string][]}
        />
        <FilterSelect
          name="instrument"
          label="Instrument"
          value={instrument}
          options={Object.entries(INSTRUMENT_SHORT) as [string, string][]}
        />
        {official && user.role !== "regional_officer" && (
          <FilterSelect
            name="region"
            label="Region"
            value={region}
            options={Object.entries(REGION_LABELS) as [string, string][]}
          />
        )}
        <FilterSelect
          name="sort"
          label="Sort"
          value={sort}
          options={[
            ["maturity", "Earliest maturity"],
            ["amount", "Largest amount"],
          ]}
        />
      </FilterBar>

      <Card bodyClassName="p-0">
        {error ? (
          <EmptyState title="Could not load deposits">{error.message}</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title="No deposits match these filters">
            {user.role === "institute_user" && (
              <Link href="/deposits/new" className="text-brand-700 hover:underline">
                Register a deposit
              </Link>
            )}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  {official && <th>Institution</th>}
                  <th>Instrument</th>
                  <th className="text-right">Amount</th>
                  <th>Issue</th>
                  <th>Maturity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/deposits/${d.id}`} className="font-medium text-brand-700 hover:underline">
                        {d.reference_no}
                      </Link>
                      {d.approval_case_id && <div className="text-xs text-slate-500">{d.approval_case_id}</div>}
                    </td>
                    {official && (
                      <td className="max-w-56">
                        <div className="truncate">{d.institution_name}</div>
                        <div className="text-xs text-slate-500">
                          {d.institution_aicte_id} · {REGION_LABELS[d.region].split(" ")[0]}
                        </div>
                      </td>
                    )}
                    <td>
                      <div>
                        {INSTRUMENT_SHORT[d.instrument_type]} {d.instrument_number}
                      </div>
                      <div className="text-xs text-slate-500">{d.bank_name}</div>
                    </td>
                    <td className="num text-right">{formatINR(d.amount)}</td>
                    <td className="num whitespace-nowrap">{formatDate(d.issue_date)}</td>
                    <td className="whitespace-nowrap">
                      <div className="num">{formatDate(d.maturity_date)}</div>
                      {d.validity && d.validity !== "active" && (
                        <div className="text-xs text-slate-500">{daysLabel(d.days_to_maturity)}</div>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={d.status} />
                        <ValidityBadge validity={d.validity} />
                        {d.status === "submitted" && <AgeBadge since={d.submitted_at} label="Submitted" />}
                        {d.open_errors > 0 && (
                          <span className="text-xs font-medium text-amber-700">
                            {d.open_errors} flag{d.open_errors === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath="/deposits" params={params} page={page} total={count ?? 0} />
      </Card>
    </>
  );
}
