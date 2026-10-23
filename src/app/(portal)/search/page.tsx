import type { Metadata } from "next";
import Link from "next/link";
import { isOfficial, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatINR } from "@/lib/format";
import { param, searchTerm } from "@/lib/query";
import type { DemandOverview, DepositOverview, Institution, ReleaseOverview } from "@/lib/types";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DemandStatusBadge, ReleaseStatusBadge, StatusBadge } from "@/components/badges";

export const metadata: Metadata = { title: "Search" };

const DEPOSIT_FIELDS = [
  "reference_no",
  "instrument_number",
  "bank_name",
  "institution_name",
  "institution_aicte_id",
  "approval_case_id",
];
const RELEASE_FIELDS = ["reference_no", "deposit_reference_no", "instrument_number", "institution_name", "institution_aicte_id"];
const DEMAND_FIELDS = ["reference_no", "approval_case_id", "program", "institution_name", "institution_aicte_id"];

const anyOf = (fields: string[], q: string) => fields.map((c) => `${c}.ilike.*${q}*`).join(",");

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const user = await requireUser();
  const official = isOfficial(user.role);
  const q = searchTerm(param(params.q));
  const supabase = await createClient();

  const [depositsRes, releasesRes, demandsRes, institutionsRes] = q
    ? await Promise.all([
        supabase
          .from("deposit_overview")
          .select("*")
          .or(anyOf(DEPOSIT_FIELDS, q))
          .order("updated_at", { ascending: false })
          .limit(8),
        supabase
          .from("release_overview")
          .select("*")
          .or(anyOf(RELEASE_FIELDS, q))
          .order("created_at", { ascending: false })
          .limit(6),
        supabase.from("demand_overview").select("*").or(anyOf(DEMAND_FIELDS, q)).order("due_date").limit(6),
        official
          ? supabase
              .from("institutions")
              .select("id, name, aicte_id, region, state")
              .or(`name.ilike.*${q}*,aicte_id.ilike.*${q}*`)
              .order("name")
              .limit(6)
          : Promise.resolve({ data: [] }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const deposits = (depositsRes.data ?? []) as DepositOverview[];
  const releases = (releasesRes.data ?? []) as ReleaseOverview[];
  const demands = (demandsRes.data ?? []) as DemandOverview[];
  const institutions = (institutionsRes.data ?? []) as Pick<Institution, "id" | "name" | "aicte_id" | "state">[];

  return (
    <>
      <PageHeader
        eyebrow="Search"
        title={q ? `Results for “${q}”` : "Search the register"}
        description="Deposits, release requests, deposit demands and institutions — only records within your scope are searched."
      />

      {!q ? (
        <Card>
          <EmptyState title="Enter a reference, instrument or institution">
            Use the search box in the sidebar. Examples: a deposit reference (<span className="num">SD-2026-000123</span>),
            an FDR number, an approval case, or an institution name.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card
            title={`Deposits (${deposits.length})`}
            actions={
              <Link href={`/deposits?q=${encodeURIComponent(q)}`} className="text-xs font-medium text-brand-700 hover:underline">
                View all
              </Link>
            }
            bodyClassName="p-0"
          >
            {deposits.length ? (
              <ul className="divide-y divide-slate-100">
                {deposits.map((d) => (
                  <li key={d.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/deposits/${d.id}`} className="font-medium text-brand-700 hover:underline">
                        {d.reference_no}
                      </Link>
                      <StatusBadge status={d.status} />
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {official && `${d.institution_name} · `}
                      {d.instrument_number} · {d.bank_name} · {formatINR(d.amount)} · maturity {formatDate(d.maturity_date)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No deposits match" />
            )}
          </Card>

          <Card
            title={`Release requests (${releases.length})`}
            actions={
              <Link href={`/releases?q=${encodeURIComponent(q)}`} className="text-xs font-medium text-brand-700 hover:underline">
                View all
              </Link>
            }
            bodyClassName="p-0"
          >
            {releases.length ? (
              <ul className="divide-y divide-slate-100">
                {releases.map((r) => (
                  <li key={r.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/releases/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.reference_no}
                      </Link>
                      <ReleaseStatusBadge status={r.status} />
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      Deposit {r.deposit_reference_no} · {official ? `${r.institution_name} · ` : ""}
                      {formatINR(r.amount)} · submitted {formatDate(r.submitted_at)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No release requests match" />
            )}
          </Card>

          <Card
            title={`Demand notices (${demands.length})`}
            actions={
              <Link href={`/demands?q=${encodeURIComponent(q)}`} className="text-xs font-medium text-brand-700 hover:underline">
                View all
              </Link>
            }
            bodyClassName="p-0"
          >
            {demands.length ? (
              <ul className="divide-y divide-slate-100">
                {demands.map((d) => (
                  <li key={d.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/demands?q=${encodeURIComponent(d.approval_case_id)}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {d.reference_no}
                      </Link>
                      <DemandStatusBadge status={d.status} overdue={d.is_overdue} />
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {official && `${d.institution_name} · `}
                      {d.approval_case_id} · {formatINR(d.required_amount)} · due {formatDate(d.due_date)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No demands match" />
            )}
          </Card>

          {official && (
            <Card title={`Institutions (${institutions.length})`} bodyClassName="p-0">
              {institutions.length ? (
                <ul className="divide-y divide-slate-100">
                  {institutions.map((i) => (
                    <li key={i.id} className="px-5 py-3">
                      <Link href={`/institutions/${i.id}`} className="font-medium text-brand-700 hover:underline">
                        {i.name}
                      </Link>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {i.aicte_id} · {i.state}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No institutions match" />
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
