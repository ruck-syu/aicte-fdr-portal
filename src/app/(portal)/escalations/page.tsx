import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, isOfficial, isReadOnly } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import { INSTRUMENT_SHORT, REGION_LABELS } from "@/lib/labels";
import { param, withParams } from "@/lib/query";
import type { EscalationOverview } from "@/lib/types";
import { Badge, Card, EmptyState, PageHeader, Stat, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { PrintMeta } from "@/components/print-meta";
import { acknowledgeEscalation } from "./actions";

export const metadata: Metadata = { title: "Escalation desk" };

const VIEWS = [
  ["open", "Open"],
  ["unacknowledged", "Not yet acknowledged"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

const CAN_ACKNOWLEDGE = ["regional_officer", "aicte_verifier", "admin"];

/**
 * Deposits that matured and stayed unrenewed past `escalation_days`. The daily
 * job writes these rows; officers work them here. An escalation closes by
 * itself once the institution renews or releases the instrument.
 */
export default async function EscalationsPage({ searchParams }: PageProps<"/escalations">) {
  const params = await searchParams;
  const user = await requireUser();
  if (!isOfficial(user.role)) redirect("/dashboard");

  const requested = param(params.view);
  const view = VIEWS.some(([v]) => v === requested) ? requested! : "open";
  const supabase = await createClient();

  let query = supabase
    .from("escalation_overview")
    .select("*")
    .order("days_lapsed", { ascending: false })
    .order("opened_at", { ascending: false })
    .limit(200);
  if (view === "open") query = query.is("closed_at", null);
  if (view === "unacknowledged") query = query.is("closed_at", null).is("acknowledged_at", null);
  if (view === "closed") query = query.not("closed_at", "is", null);

  const [rowsRes, openRes, unackedRes, closedRes, settingsRes] = await Promise.all([
    query,
    supabase.from("deposit_escalations").select("id", { count: "exact", head: true }).is("closed_at", null),
    supabase
      .from("deposit_escalations")
      .select("id", { count: "exact", head: true })
      .is("closed_at", null)
      .is("acknowledged_at", null),
    supabase.from("deposit_escalations").select("id", { count: "exact", head: true }).not("closed_at", "is", null),
    supabase.from("app_settings").select("escalation_days").maybeSingle(),
  ]);

  const rows = (rowsRes.data ?? []) as EscalationOverview[];
  const open = openRes.count ?? 0;
  const unacknowledged = unackedRes.count ?? 0;
  const closed = closedRes.count ?? 0;
  const oldest = rows.reduce((max, r) => Math.max(max, r.days_lapsed), 0);
  const canAcknowledge = CAN_ACKNOWLEDGE.includes(user.role) && !isReadOnly(user.role);
  const window = (settingsRes.data as { escalation_days: number } | null)?.escalation_days ?? 7;

  return (
    <>
      <PrintMeta label={`Escalations · ${view}`} />
      <PageHeader
        title="Escalation desk"
        description="Instruments that matured and were not renewed within the escalation window. The daily job opens these cases, notifies the regional officer and closes them automatically once a renewed deposit is filed or the deposit is released."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open escalations" value={open} tone={open ? "red" : "slate"} hint="Awaiting a renewed deposit" />
        <Stat
          label="Not yet acknowledged"
          value={unacknowledged}
          tone={unacknowledged ? "amber" : "slate"}
          hint="No officer has picked these up"
        />
        <Stat label="Closed" value={closed} hint="Renewed, released or replaced" />
        <Stat
          label="Oldest open case"
          value={open ? `${oldest} d` : "—"}
          hint={open ? "Days past maturity on this page" : "Nothing open"}
        />
      </div>

      <div className="mt-5 mb-4 flex flex-wrap items-center gap-1 text-sm">
        {VIEWS.map(([v, label]) => (
          <Link
            key={v}
            href={`/escalations${withParams(params, { view: v === "open" ? null : v })}`}
            className={cx(
              "rounded-md px-3 py-1.5",
              view === v
                ? "bg-white font-medium shadow-xs ring-1 ring-slate-200"
                : "text-slate-600 hover:bg-white",
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      <Card bodyClassName="p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState title={view === "open" ? "No open escalations" : "Nothing in this view"}>
            {view === "open"
              ? "Every lapsed instrument is either renewed, released, or still inside the escalation window."
              : "Try a different view."}
          </EmptyState>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Deposit</th>
                <th>Institution</th>
                <th>Region</th>
                <th className="text-right">Amount</th>
                <th>Matured</th>
                <th className="text-right">Lapsed</th>
                <th>Status</th>
                {canAcknowledge && <th className="no-print">Acknowledge</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={cx(r.closed_at && "text-slate-500")}>
                  <td>
                    <Link href={`/deposits/${r.deposit_id}`} className="font-medium text-brand-700 hover:underline">
                      {r.reference_no}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {INSTRUMENT_SHORT[r.instrument_type]} · {r.instrument_number} · {r.bank_name}
                    </div>
                  </td>
                  <td>
                    <Link
                      href={`/institutions/${r.institution_id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {r.institution_name}
                    </Link>
                    <div className="text-xs text-slate-500">{r.institution_aicte_id}</div>
                  </td>
                  <td className="whitespace-nowrap">{REGION_LABELS[r.region]}</td>
                  <td className="num text-right">{formatINR(r.amount)}</td>
                  <td className="num whitespace-nowrap">{formatDate(r.maturity_date)}</td>
                  <td className="num text-right font-medium">{r.days_lapsed} d</td>
                  <td>
                    {r.closed_at ? (
                      <Badge tone="green">Closed {formatDate(r.closed_at)}</Badge>
                    ) : r.acknowledged_at ? (
                      <div>
                        <Badge tone="blue">Acknowledged</Badge>
                        <div className="mt-1 text-xs text-slate-500">
                          {r.acknowledged_by_name ?? r.acknowledged_by_email ?? "Officer"} ·{" "}
                          {formatDateTime(r.acknowledged_at)}
                        </div>
                        {r.note && <div className="mt-1 max-w-xs text-xs text-slate-600">{r.note}</div>}
                      </div>
                    ) : (
                      <Badge tone="red">Unacknowledged</Badge>
                    )}
                  </td>
                  {canAcknowledge && (
                    <td className="no-print">
                      {!r.closed_at && !r.acknowledged_at ? (
                        <ActionForm action={acknowledgeEscalation} className="space-y-1.5">
                          <input type="hidden" name="id" value={r.id} />
                          <input
                            name="note"
                            placeholder="Action taken (optional)"
                            aria-label={`Action taken for ${r.reference_no}`}
                            className="input w-48 py-1 text-xs"
                          />
                          <SubmitButton variant="secondary" size="sm">
                            Acknowledge
                          </SubmitButton>
                        </ActionForm>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="mt-3 text-xs text-slate-500">
        {rows.length} case{rows.length === 1 ? "" : "s"} shown{rows.length === 200 && " (first 200)"}. Escalations open
        once an instrument has been matured for more than {window} day{window === 1 ? "" : "s"}
        {user.role === "admin" ? (
          <>
            {" "}
            — change the window under <Link href="/admin/settings" className="text-brand-700 hover:underline">Settings</Link>.
          </>
        ) : (
          "."
        )}
      </p>
    </>
  );
}
