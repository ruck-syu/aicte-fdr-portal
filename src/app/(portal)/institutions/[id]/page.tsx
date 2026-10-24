import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatINR } from "@/lib/format";
import { INSTRUMENT_SHORT, REGION_LABELS, RELEASE_REASON_LABELS } from "@/lib/labels";
import type { DemandOverview, DepositOverview, Institution, ReleaseOverview } from "@/lib/types";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { DemandStatusBadge, ReleaseStatusBadge, StatusBadge, ValidityBadge } from "@/components/badges";
import { PrintMeta } from "@/components/print-meta";

export const metadata: Metadata = { title: "Institution" };

/**
 * One institution's register: who they are, what they hold and what is open.
 * Every query runs as the signed-in user, so row-level security decides whether
 * an officer can see the institution at all.
 */
export default async function InstitutionPage({ params }: PageProps<"/institutions/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: institution } = await supabase.from("institutions").select("*").eq("id", id).maybeSingle();
  if (!institution) notFound();
  const i = institution as Institution;

  const count = (status?: "held" | "lapsed" | "pending", table: "deposits" | "demands" | "releases" = "deposits") => {
    let q =
      table === "deposits"
        ? supabase.from("deposit_overview").select("id", { count: "exact", head: true }).eq("institution_id", id)
        : table === "demands"
          ? supabase.from("demand_overview").select("id", { count: "exact", head: true }).eq("institution_id", id)
          : supabase.from("release_overview").select("id", { count: "exact", head: true }).eq("institution_id", id);
    if (table === "deposits" && status === "held") q = q.in("status", ["verified", "release_requested"]);
    if (table === "deposits" && status === "lapsed") q = q.eq("validity", "expired");
    if (table === "deposits" && status === "pending") q = q.eq("status", "submitted");
    if (table === "demands") q = q.eq("status", "open");
    // Undecided includes releases parked for a second signature.
    if (table === "releases") q = q.in("status", ["submitted", "pending_second_approval"]);
    return q;
  };

  const [onRegister, held, lapsed, pending, openDemands, pendingReleases, depositsRes, demandsRes, releasesRes] =
    await Promise.all([
      count(),
      count("held"),
      count("lapsed"),
      count("pending"),
      count(undefined, "demands"),
      count(undefined, "releases"),
      supabase
        .from("deposit_overview")
        .select("*")
        .eq("institution_id", id)
        .order("updated_at", { ascending: false })
        .limit(5),
      supabase.from("demand_overview").select("*").eq("institution_id", id).order("due_date", { ascending: false }).limit(5),
      supabase
        .from("release_overview")
        .select("*")
        .eq("institution_id", id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const deposits = (depositsRes.data ?? []) as DepositOverview[];
  const demands = (demandsRes.data ?? []) as DemandOverview[];
  const releases = (releasesRes.data ?? []) as ReleaseOverview[];
  const search = `q=${encodeURIComponent(i.aicte_id)}`;

  const stats: { label: string; value: number; hint?: string; href: string; tone?: string }[] = [
    { label: "Deposits on register", value: onRegister.count ?? 0, hint: `${held.count ?? 0} held`, href: `/deposits?${search}` },
    {
      label: "Matured, not renewed",
      value: lapsed.count ?? 0,
      hint: lapsed.count ? "Unsecured" : "None",
      href: `/deposits?${search}&validity=expired`,
      tone: lapsed.count ? "text-red-700" : undefined,
    },
    { label: "Pending verification", value: pending.count ?? 0, href: `/deposits?${search}&status=submitted` },
    { label: "Open demands", value: openDemands.count ?? 0, href: `/demands?${search}&status=open` },
    { label: "Releases under review", value: pendingReleases.count ?? 0, href: `/releases?${search}&status=submitted` },
  ];

  return (
    <>
      <PrintMeta label={`Institution ${i.name} (${i.aicte_id})`} />
      <PageHeader
        eyebrow={
          user.role === "admin" ? (
            <Link href="/admin/institutions" className="hover:underline">
              Institutions
            </Link>
          ) : undefined
        }
        title={i.name}
        description={
          <>
            {i.aicte_id} · {REGION_LABELS[i.region]} · {[i.city, i.state].filter(Boolean).join(", ")}
            {i.contact_email && (
              <>
                {" "}
                · <span className="break-all">{i.contact_email}</span>
              </>
            )}
            {i.contact_phone && <> · {i.contact_phone}</>}
          </>
        }
        actions={
          <>
            <LinkButton href={`/deposits?${search}`} variant="secondary">
              All deposits
            </LinkButton>
            <LinkButton href={`/demands?${search}`} variant="secondary">
              All demands
            </LinkButton>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs transition-colors hover:border-brand-300 hover:bg-brand-50/30"
          >
            <div className="text-xs font-medium text-slate-500">{s.label}</div>
            <div className={`num mt-1 text-xl font-semibold ${s.tone ?? "text-slate-900"}`}>{s.value}</div>
            {s.hint && <div className="text-xs text-slate-500">{s.hint}</div>}
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card
          title="Latest deposits"
          description="Most recently updated instruments"
          actions={
            <Link href={`/deposits?${search}`} className="text-xs font-medium text-brand-700 hover:underline">
              View all
            </Link>
          }
          bodyClassName="p-0 overflow-x-auto"
        >
          {deposits.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th className="text-right">Amount</th>
                  <th>Maturity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/deposits/${d.id}`} className="font-medium text-brand-700 hover:underline">
                        {d.reference_no}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {INSTRUMENT_SHORT[d.instrument_type]} · {d.instrument_number}
                      </div>
                    </td>
                    <td className="num text-right">{formatINR(d.amount)}</td>
                    <td className="num whitespace-nowrap">{formatDate(d.maturity_date)}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={d.status} />
                        <ValidityBadge validity={d.validity} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No deposits registered" />
          )}
        </Card>

        <Card
          title="Latest demands"
          description="Deposits AICTE has asked for"
          actions={
            <Link href={`/demands?${search}`} className="text-xs font-medium text-brand-700 hover:underline">
              View all
            </Link>
          }
          bodyClassName="p-0 overflow-x-auto"
        >
          {demands.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Demand</th>
                  <th className="text-right">Required</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {demands.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="font-medium text-slate-800">{m.reference_no}</div>
                      <div className="text-xs text-slate-500">{m.approval_case_id}</div>
                    </td>
                    <td className="num text-right">{formatINR(m.required_amount)}</td>
                    <td className="num whitespace-nowrap">{formatDate(m.due_date)}</td>
                    <td>
                      <DemandStatusBadge status={m.status} overdue={m.is_overdue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No demands issued" />
          )}
        </Card>
      </div>

      <Card
        className="mt-6"
        title="Latest releases"
        description="Release and refund applications"
        actions={
          <Link href={`/releases?${search}`} className="text-xs font-medium text-brand-700 hover:underline">
            View all
          </Link>
        }
        bodyClassName="p-0 overflow-x-auto"
      >
        {releases.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Deposit</th>
                <th className="text-right">Amount</th>
                <th>Reason</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/releases/${r.id}`} className="font-medium text-brand-700 hover:underline">
                      {r.reference_no}
                    </Link>
                  </td>
                  <td>{r.deposit_reference_no}</td>
                  <td className="num text-right">{formatINR(r.amount)}</td>
                  <td>{RELEASE_REASON_LABELS[r.reason]}</td>
                  <td className="num whitespace-nowrap">{formatDate(r.submitted_at ?? r.created_at)}</td>
                  <td>
                    <ReleaseStatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No release requests" />
        )}
      </Card>
    </>
  );
}
