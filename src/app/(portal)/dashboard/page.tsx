import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser, isOfficial } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatINR, formatINRCompact, daysLabel } from "@/lib/format";
import { INSTRUMENT_SHORT, REGION_LABELS, ROLE_LABELS } from "@/lib/labels";
import type { DashboardStats, DemandOverview, DepositOverview, DepositStatus, Region } from "@/lib/types";
import { Card, DescriptionList, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { AgeBadge, DemandStatusBadge, StatusBadge, ValidityBadge } from "@/components/badges";
import { MaturityChart } from "@/components/maturity-chart";
import { RegionHeatmap, type RegionStatusCounts } from "@/components/region-heatmap";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const official = isOfficial(user.role);
  const supabase = await createClient();

  const [statsRes, upcomingRes, queueRes, demandsRes] = await Promise.all([
    supabase.rpc("dashboard_stats"),
    supabase
      .from("deposit_overview")
      .select("*")
      .in("status", ["verified", "release_requested"])
      .order("maturity_date")
      .limit(8),
    official
      ? supabase
          .from("deposit_overview")
          .select("*")
          .eq("status", "submitted")
          .order("submitted_at")
          .limit(8)
      : supabase
          .from("deposit_overview")
          .select("*")
          .in("status", ["draft", "discrepancy"])
          .order("updated_at", { ascending: false })
          .limit(8),
    supabase
      .from("demand_overview")
      .select("*")
      .eq("status", "open")
      .order("due_date")
      .limit(6),
  ]);

  // Region × status is a cross-tab, and there is no rollup function for it.
  // Read the scoped view in pages and tally here; RLS still decides what is visible.
  const regionRows: RegionStatusCounts[] = [];
  if (official) {
    const pageSize = 1000;
    const regions =
      user.role === "regional_officer" && user.region
        ? [user.region]
        : (Object.keys(REGION_LABELS) as Region[]);
    const buckets = new Map<Region, RegionStatusCounts>(
      regions.map((region) => [region, { region, held: 0, pending: 0, returned: 0, released: 0 }]),
    );
    for (let page = 0; page < 50; page++) {
      const { data, error } = await supabase
        .from("deposit_overview")
        .select("region, status")
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (error || !data?.length) break;
      for (const row of data as { region: Region; status: DepositStatus }[]) {
        const bucket = buckets.get(row.region);
        if (!bucket) continue;
        if (row.status === "verified" || row.status === "release_requested") bucket.held += 1;
        else if (row.status === "submitted") bucket.pending += 1;
        else if (row.status === "discrepancy") bucket.returned += 1;
        else if (row.status === "released") bucket.released += 1;
      }
      if (data.length < pageSize) break;
    }
    regionRows.push(...buckets.values());
  }

  const s = (statsRes.data ?? {}) as DashboardStats;
  const upcoming = (upcomingRes.data ?? []) as DepositOverview[];
  const queue = (queueRes.data ?? []) as DepositOverview[];
  const demands = (demandsRes.data ?? []) as DemandOverview[];

  const hours = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v} h`);
  const days = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v} days`);
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);

  const scope =
    user.role === "institute_user"
      ? user.institution?.name
      : user.role === "regional_officer" && user.region
        ? `${REGION_LABELS[user.region]} region`
        : "All AICTE regions";

  return (
    <>
      <PageHeader
        eyebrow={`${ROLE_LABELS[user.role]} · ${scope}`}
        title={`Welcome${user.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}`}
        description="Security deposits held, upcoming maturities and work waiting on you."
        actions={
          user.role === "institute_user" ? (
            <LinkButton href="/deposits/new">
              <Plus className="size-4" /> Register deposit
            </LinkButton>
          ) : (
            <LinkButton href="/deposits?status=submitted" variant="secondary">
              Open verification queue
            </LinkButton>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Deposits held"
          value={formatINRCompact(s.held_value ?? 0)}
          hint={`${s.held_count ?? 0} verified instrument${s.held_count === 1 ? "" : "s"}`}
          tone="blue"
          href="/deposits?status=held"
        />
        <Stat
          label="Maturing within 60 days"
          value={s.maturing ?? 0}
          hint="Renewal needed before maturity"
          tone={s.maturing ? "amber" : "slate"}
          href="/deposits?validity=maturing"
        />
        <Stat
          label="Matured, not renewed"
          value={s.expired ?? 0}
          hint="Non-compliant: escalates automatically"
          tone={s.expired ? "red" : "slate"}
          href="/deposits?validity=expired"
        />
        {official ? (
          <Stat
            label="Pending verification"
            value={s.pending_verification ?? 0}
            hint={`${s.flagged ?? 0} with discrepancy flags`}
            tone={s.flagged ? "amber" : "slate"}
            href="/deposits?status=submitted"
          />
        ) : (
          <Stat
            label="Needs action"
            value={(s.drafts ?? 0) + (s.returned ?? 0)}
            hint={`${s.returned ?? 0} returned · ${s.drafts ?? 0} draft${s.drafts === 1 ? "" : "s"}`}
            tone={s.returned ? "amber" : "slate"}
            href="/deposits?status=discrepancy"
          />
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Open deposit demands"
          value={s.open_demands ?? 0}
          hint={`${s.overdue_demands ?? 0} overdue`}
          tone={s.overdue_demands ? "red" : "slate"}
          href="/demands"
        />
        <Stat
          label="Release requests under review"
          value={s.release_pending ?? 0}
          href="/releases?status=submitted"
        />
        <Stat label="Released to date" value={formatINRCompact(s.released_value ?? 0)} href="/deposits?status=released" />
      </div>

      {official && (
        <Card
          className="mt-4"
          title="Service levels"
          description="Submission-to-verification turnaround (last 90 days), renewal compliance and how long open flags have been waiting."
        >
          <DescriptionList
            items={[
              { label: "Average verification", value: <span className="num">{hours(s.avg_verification_hours)}</span> },
              { label: "Verification p90", value: <span className="num">{hours(s.p90_verification_hours)}</span> },
              { label: "Renewal compliance", value: <span className="num">{pct(s.renewal_compliance_pct)}</span> },
              { label: "Open flag median age", value: <span className="num">{days(s.open_flag_p50_days)}</span> },
              { label: "Open flag p90 age", value: <span className="num">{days(s.open_flag_p90_days)}</span> },
            ]}
          />
        </Card>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Value maturing per month"
          description="Verified deposits by maturity month, next 12 months"
        >
          {s.maturity_timeline?.length ? (
            <MaturityChart data={s.maturity_timeline} />
          ) : (
            <EmptyState title="No data yet" />
          )}
        </Card>

        {official ? (
          <Card title="Region × status" description="Instruments by region and workflow state" bodyClassName="p-4">
            <RegionHeatmap rows={regionRows} />
          </Card>
        ) : (
          <Card
            title="Open deposit demands"
            description="Deposits AICTE has asked you to furnish"
            bodyClassName="p-0"
          >
            {demands.length ? (
              <ul className="divide-y divide-slate-100">
                {demands.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">{d.approval_case_id}</div>
                      <div className="text-xs text-slate-500">
                        {formatINR(d.required_amount)} · due {formatDate(d.due_date)}
                      </div>
                      {d.deposits_submitted === 0 && (
                        <Link
                          href={`/deposits/new?demand=${d.id}`}
                          className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline"
                        >
                          Furnish deposit →
                        </Link>
                      )}
                    </div>
                    <DemandStatusBadge status={d.status} overdue={d.is_overdue} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No open demands" />
            )}
          </Card>
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card
          title="Upcoming maturities"
          description="Earliest-maturing verified instruments"
          actions={
            <Link href="/deposits?status=held&sort=maturity" className="text-xs font-medium text-brand-700 hover:underline">
              View all
            </Link>
          }
          bodyClassName="p-0 overflow-x-auto"
        >
          {upcoming.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Deposit</th>
                  {official && <th>Institution</th>}
                  <th className="text-right">Amount</th>
                  <th>Maturity</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/deposits/${d.id}`} className="font-medium text-brand-700 hover:underline">
                        {d.reference_no}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {INSTRUMENT_SHORT[d.instrument_type]} · {d.bank_name}
                      </div>
                    </td>
                    {official && <td className="max-w-48 truncate">{d.institution_name}</td>}
                    <td className="num text-right">{formatINR(d.amount)}</td>
                    <td>
                      <div className="num">{formatDate(d.maturity_date)}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                        <ValidityBadge validity={d.validity} />
                        {d.validity !== "active" && daysLabel(d.days_to_maturity)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No verified deposits yet" />
          )}
        </Card>

        <Card
          title={official ? "Verification queue" : "Drafts & returned deposits"}
          description={official ? "Oldest submissions first" : "Complete and submit these for verification"}
          bodyClassName="p-0 overflow-x-auto"
        >
          {queue.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Deposit</th>
                  {official && <th>Institution</th>}
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/deposits/${d.id}`} className="font-medium text-brand-700 hover:underline">
                        {d.reference_no}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span>{official ? `Submitted ${formatDate(d.submitted_at)}` : d.instrument_number}</span>
                        {official && d.status === "submitted" && <AgeBadge since={d.submitted_at} label="Waiting" />}
                      </div>
                    </td>
                    {official && <td className="max-w-48 truncate">{d.institution_name}</td>}
                    <td className="num text-right">{formatINR(d.amount)}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={d.status} />
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
          ) : (
            <EmptyState title={official ? "Nothing waiting for verification" : "Nothing pending"} />
          )}
        </Card>
      </div>
    </>
  );
}
