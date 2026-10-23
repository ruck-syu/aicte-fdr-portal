import type { Metadata } from "next";
import Link from "next/link";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { requireUser, isOfficial } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { param } from "@/lib/query";
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

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const params = await searchParams;
  const user = await requireUser();
  const unreadOnly = param(params.view) === "unread";
  const supabase = await createClient();
  const { data } = await supabase.rpc("notification_feed", { p_limit: 200, p_unread_only: unreadOnly });
  const items = (data ?? []) as FeedItem[];
  const unread = items.filter((n) => !n.is_read).length;

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
      <div className="mb-4 flex gap-1 text-sm">
        {[
          ["", "All"],
          ["unread", "Unread"],
        ].map(([v, l]) => (
          <Link
            key={v}
            href={v ? `/notifications?view=${v}` : "/notifications"}
            className={cx(
              "rounded-md px-3 py-1.5",
              (unreadOnly ? "unread" : "") === v ? "bg-white font-medium shadow-xs ring-1 ring-slate-200" : "text-slate-600 hover:bg-white",
            )}
          >
            {l}
          </Link>
        ))}
      </div>
      <Card bodyClassName="p-0">
        {items.length === 0 ? (
          <EmptyState title={unreadOnly ? "You're all caught up" : "No alerts yet"} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => {
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
      </Card>
    </>
  );
}
