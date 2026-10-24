import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ACTION_LABELS, ENTITY_LABELS, describeAudit } from "@/lib/audit";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/labels";
import { pageRange, param, searchTerm, withParams } from "@/lib/query";
import type { AuditLog } from "@/lib/types";
import { Badge, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { FilterBar, FilterSelect, Pagination } from "@/components/list-controls";

export const metadata: Metadata = { title: "Audit trail" };

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Calendar day in IST, `daysBack` days before today. */
const istDay = (daysBack = 0) =>
  new Date(Date.now() + 5.5 * 3600 * 1000 - daysBack * 86_400_000).toISOString().slice(0, 10);

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const params = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  const q = searchTerm(params.q);
  const entity = param(params.entity);
  const action = param(params.action);
  const from = param(params.from);
  const to = param(params.to);
  const { page, from: start, to: end } = pageRange(params.page);

  let query = supabase.from("audit_logs").select("*", { count: "exact" });
  if (q) query = query.or(`summary.ilike.*${q}*,actor_email.ilike.*${q}*`);
  if (entity in ENTITY_LABELS) query = query.eq("entity_type", entity);
  if (action in ACTION_LABELS) query = query.eq("action", action);
  if (isDate(from)) query = query.gte("occurred_at", `${from}T00:00:00+05:30`);
  if (isDate(to)) query = query.lte("occurred_at", `${to}T23:59:59.999+05:30`);

  const { data, count } = await query.order("occurred_at", { ascending: false }).range(start, end);
  const logs = (data ?? []) as AuditLog[];

  return (
    <>
      <PageHeader
        title="Audit trail"
        description={
          user.role === "admin"
            ? "Every change, sign-in, document view and export across the portal. Entries are append-only and cannot be edited or deleted."
            : "Every change, sign-in, document view and export within your scope. Entries are append-only and cannot be edited or deleted."
        }
        actions={
          <a
            href={`/api/audit/export${withParams(params, { page: null })}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-xs hover:bg-slate-50"
          >
            <Download className="size-4" /> Export CSV
          </a>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 text-slate-500">Quick range</span>
        {[
          ["Today", 0],
          ["Last 7 days", 6],
          ["Last 30 days", 29],
        ].map(([label, daysBack]) => {
          const start = istDay(daysBack as number);
          const end = istDay();
          const active = from === start && to === end;
          return (
            <Link
              key={label}
              href={`/audit${withParams(params, { from: start, to: end, page: null })}`}
              className={cx(
                "rounded-full px-2.5 py-1",
                active ? "bg-brand-700 font-medium text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
              )}
            >
              {label}
            </Link>
          );
        })}
        {(from || to) && (
          <Link href={`/audit${withParams(params, { from: null, to: null, page: null })}`} className="ml-1 text-brand-700 hover:underline">
            Clear dates
          </Link>
        )}
      </div>

      <FilterBar action="/audit" q={q} placeholder="Search summary or user email…" resetHref="/audit">
        <FilterSelect name="entity" label="Record" value={entity} options={Object.entries(ENTITY_LABELS)} />
        <FilterSelect name="action" label="Action" value={action} options={Object.entries(ACTION_LABELS)} />
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          From
          <input type="date" name="from" defaultValue={isDate(from) ? from : ""} className="input w-auto" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          To
          <input type="date" name="to" defaultValue={isDate(to) ? to : ""} className="input w-auto" />
        </label>
      </FilterBar>

      <Card bodyClassName="p-0">
        {logs.length === 0 ? (
          <EmptyState title="No matching entries" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Record</th>
                  <th>Event</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="num whitespace-nowrap text-slate-600">{formatDateTime(log.occurred_at)}</td>
                    <td className="whitespace-nowrap">
                      <div className="text-slate-800">{log.actor_email ?? "System"}</div>
                      {log.actor_role && <div className="text-xs text-slate-500">{ROLE_LABELS[log.actor_role]}</div>}
                    </td>
                    <td className="whitespace-nowrap">
                      <Badge>{ENTITY_LABELS[log.entity_type] ?? log.entity_type}</Badge>
                    </td>
                    <td className="min-w-80">
                      <span className="text-slate-800">{describeAudit(log)}</span>
                      {log.deposit_id && log.entity_type !== "session" && (
                        <Link href={`/deposits/${log.deposit_id}`} className="ml-2 text-xs text-brand-700 hover:underline">
                          View deposit
                        </Link>
                      )}
                      {log.action === "update" && log.changes && (
                        <details className="mt-1 text-xs text-slate-500">
                          <summary className="cursor-pointer select-none">Changes</summary>
                          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                            {Object.entries(log.changes as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => (
                              <div key={k} className="contents">
                                <dt className="font-medium text-slate-600">{k}</dt>
                                <dd className="break-all">
                                  {JSON.stringify(v?.from ?? null)} → {JSON.stringify(v?.to ?? null)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath="/audit" params={params} page={page} total={count ?? 0} />
      </Card>
    </>
  );
}
