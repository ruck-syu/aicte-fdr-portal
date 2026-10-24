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
import { SortLink } from "@/components/sort-link";
import { PrintButton } from "@/components/print-button";
import { PrintMeta } from "@/components/print-meta";

export const metadata: Metadata = { title: "Deposits" };

const STATUS_OPTIONS: [string, string][] = [
  ["held", "Held (verified + release requested)"],
  ...(Object.entries(STATUS_LABELS) as [string, string][]),
];

// Columns the register can be ordered by, through ?sort=&dir=.
const SORT_FIELDS = {
  reference: "reference_no",
  institution: "institution_name",
  amount: "amount",
  issue: "issue_date",
  maturity: "maturity_date",
} as const;
type SortKey = keyof typeof SORT_FIELDS | "updated";
const ASC_BY_DEFAULT: SortKey[] = ["reference", "institution", "issue", "maturity"];
const SORT_LABELS: Record<SortKey, string> = {
  reference: "reference",
  institution: "institution",
  amount: "amount (high to low)",
  issue: "issue date",
  maturity: "maturity date",
  updated: "recently updated",
};

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
  const requestedSort = param(params.sort);
  const sort: SortKey = requestedSort in SORT_FIELDS ? (requestedSort as keyof typeof SORT_FIELDS) : "updated";
  const requestedDir = param(params.dir);
  const dir: "asc" | "desc" =
    requestedDir === "asc" || requestedDir === "desc"
      ? requestedDir
      : ASC_BY_DEFAULT.includes(sort)
        ? "asc"
        : "desc";
  const { page, from, to } = pageRange(params.page);

  // Clicking the active column reverses it; a new column starts at its natural order.
  const sortHref = (key: keyof typeof SORT_FIELDS) => {
    const nextDir = sort === key ? (dir === "asc" ? "desc" : "asc") : ASC_BY_DEFAULT.includes(key) ? "asc" : "desc";
    return `/deposits${withParams(params, { sort: key, dir: nextDir, page: null })}`;
  };

  // Built twice: once for the page, once to total the money across the same filter.
  const filtered = () => {
    // Archived records are frozen evidence, not live holdings: they live on the
    // Archival due report and their own detail page.
    let query = supabase.from("deposit_overview").select("*", { count: "exact" }).is("archived_at", null);
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
    return query;
  };

  const [{ data, count, error }, { data: amountRows }] = await Promise.all([
    filtered()
      .order(sort === "updated" ? "updated_at" : SORT_FIELDS[sort], { ascending: dir === "asc" })
      .range(from, to),
    // PostgREST caps a response at 1,000 rows; beyond that the total is a lower bound.
    filtered().select("amount").limit(1000),
  ]);
  const rows = (data ?? []) as DepositOverview[];

  const amounts = (amountRows ?? []) as { amount: number }[];
  const filteredTotal = amounts.reduce((sum, r) => sum + Number(r.amount), 0);
  const totalCapped = (count ?? 0) > amounts.length;

  const statusLabel = STATUS_OPTIONS.find(([v]) => v === status)?.[1];
  const validityLabel = validity in VALIDITY_LABELS ? VALIDITY_LABELS[validity as Validity] : null;
  const instrumentLabel = instrument in INSTRUMENT_LABELS ? INSTRUMENT_LABELS[instrument as InstrumentType] : null;
  const regionLabel = region in REGION_LABELS ? REGION_LABELS[region as Region] : null;
  const filterSummary = [
    q && `search “${q}”`,
    statusLabel && `${statusLabel} only`,
    validityLabel && `${validityLabel} only`,
    instrumentLabel,
    regionLabel,
    `sorted by ${SORT_LABELS[sort]}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <PrintMeta label={`Deposits · page ${page}${filterSummary ? ` · ${filterSummary}` : ""}`} />
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
            <PrintButton summary={`Deposits list · page ${page} · ${filterSummary}`} />
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
      </FilterBar>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="no-print">
          Sorted by {SORT_LABELS[sort]}. Use a column heading to re-order; the order carries into the CSV export.
        </span>
        {!error && (
          <span>
            <span className="num text-slate-700">{(count ?? 0).toLocaleString("en-IN")}</span> deposit
            {(count ?? 0) === 1 ? "" : "s"} match · total{" "}
            <span className="num font-medium text-slate-800">
              {totalCapped ? "≥ " : ""}
              {formatINR(filteredTotal)}
            </span>
            {totalCapped ? " (first 1,000)" : ""}
          </span>
        )}
      </div>

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
                  <th aria-sort={sort === "reference" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                    <SortLink
                      label="Reference"
                      href={sortHref("reference")}
                      active={sort === "reference"}
                      dir={dir}
                    />
                  </th>
                  {official && (
                    <th aria-sort={sort === "institution" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                      <SortLink
                        label="Institution"
                        href={sortHref("institution")}
                        active={sort === "institution"}
                        dir={dir}
                      />
                    </th>
                  )}
                  <th>Instrument</th>
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
                  <th aria-sort={sort === "issue" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                    <SortLink label="Issue" href={sortHref("issue")} active={sort === "issue"} dir={dir} />
                  </th>
                  <th aria-sort={sort === "maturity" ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                    <SortLink label="Maturity" href={sortHref("maturity")} active={sort === "maturity"} dir={dir} />
                  </th>
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
                        <Link
                          href={`/institutions/${d.institution_id}`}
                          className="block truncate hover:text-brand-700 hover:underline"
                        >
                          {d.institution_name}
                        </Link>
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
