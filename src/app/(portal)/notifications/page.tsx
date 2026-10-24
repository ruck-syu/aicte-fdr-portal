import type { Metadata } from "next";
import Link from "next/link";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { requireUser, isOfficial } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { param, withParams } from "@/lib/query";
import { Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { markRead } from "./actions";

export const metadata: Metadata = { title: "Alerts" };

type FeedItem = {
  id: string;
  institution_id: string | null;
  deposit_id: string | null;
  demand_id: string | null;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  created_at: string;
  is_read: boolean;
  institution_name: string | null;
};

const ICONS = {
  info: <Info className="size-4 text-brand-600" />,
  warning: <AlertTriangle className="size-4 text-amber-600" />,
  critical: <AlertOctagon className="size-4 text-red-600" />,
};

const SEVERITY_TABS = [
  ["", "All severities"],
  ["critical", "Critical"],
  ["warning", "Warning"],
  ["info", "Info"],
] as const;

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const params = await searchParams;
  const user = await requireUser();
  const unreadOnly = param(params.view) === "unread";
  const severity = param(params.severity);
  const supabase = await createClient();
  const { data } = await supabase.rpc("notification_feed", { p_limit: 200, p_unread_only: unreadOnly });
  const items = (data ?? []) as FeedItem[];
  const unread = items.filter((n) => !n.is_read).length;
  const severityFilter = SEVERITY_TABS.some(([v]) => v && v === severity) ? severity : "";
  const visible = severityFilter ? items.filter((n) => n.severity === severityFilter) : items;
  const critical = items.filter((n) => n.severity === "critical" && !n.is_read).length;

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Maturity reminders (60 / 30 / 7 days), lapsed-instrument escalations, overdue demands and workflow updates. Reminders are generated daily and emailed when email is configured."
        actions={
          unread > 0 && (
            <ActionForm action={markRead} hideOk>
              <SubmitButton variant="secondary">Mark all as read</SubmitButton>
            </ActionForm>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex gap-1">
          {[
            ["", "All"],
            ["unread", critical ? `Unread · ${critical} critical` : "Unread"],
          ].map(([v, l]) => (
            <Link
              key={v}
              href={`/notifications${withParams(params, { view: v, page: null })}`}
              className={cx(
                "rounded-md px-3 py-1.5",
                (unreadOnly ? "unread" : "") === v
                  ? "bg-white font-medium shadow-xs ring-1 ring-slate-200"
                  : "text-slate-600 hover:bg-white",
              )}
            >
              {l}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="mr-1 text-slate-500">Severity</span>
          {SEVERITY_TABS.map(([v, l]) => (
            <Link
              key={v}
              href={`/notifications${withParams(params, { severity: v, page: null })}`}
              className={cx(
                "rounded-full px-2.5 py-1",
                severityFilter === v
                  ? "bg-brand-700 font-medium text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
              )}
            >
              {l}
            </Link>
          ))}
        </div>
      </div>
      <Card bodyClassName="p-0">
        {visible.length === 0 ? (
          <EmptyState
            title={
              items.length === 0
                ? unreadOnly
                  ? "You're all caught up"
                  : "No alerts yet"
                : `No ${severityFilter} alerts in this view`
            }
          >
            {items.length > 0 && (
              <Link href={`/notifications${withParams(params, { severity: null })}`} className="text-brand-700 hover:underline">
                Clear the severity filter
              </Link>
            )}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((n) => {
              const href = n.deposit_id ? `/deposits/${n.deposit_id}` : n.demand_id ? "/demands" : null;
              return (
                <li key={n.id} className={cx("flex gap-3 px-5 py-4", !n.is_read && "bg-brand-50/40")}>
                  <div className="mt-0.5">{ICONS[n.severity]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {href ? (
                        <Link href={href} className={cx("text-sm hover:underline", !n.is_read && "font-semibold")}>
                          {n.title}
                        </Link>
                      ) : (
                        <span className={cx("text-sm", !n.is_read && "font-semibold")}>{n.title}</span>
                      )}
                      {!n.is_read && <span className="size-1.5 rounded-full bg-brand-600" aria-label="unread" />}
                    </div>
                    {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                    <p className="mt-1 text-xs text-slate-500">
                      {isOfficial(user.role) && n.institution_name && `${n.institution_name} · `}
                      {formatDateTime(n.created_at)}
                    </p>
                  </div>
                  {!n.is_read && (
                    <ActionForm action={markRead} hideOk>
                      <input type="hidden" name="id" value={n.id} />
                      <button className="text-xs text-slate-500 hover:text-slate-800 hover:underline">Mark read</button>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {visible.length > 0 && severityFilter && (
          <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">
            {visible.length} {severityFilter} alert{visible.length === 1 ? "" : "s"} shown
          </p>
        )}
      </Card>
    </>
  );
}
