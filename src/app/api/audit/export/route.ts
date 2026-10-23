import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ACTION_LABELS, ENTITY_LABELS } from "@/lib/audit";
import { param, searchTerm } from "@/lib/query";
import type { AuditLog } from "@/lib/types";

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const MAX_ROWS = 10_000;

const cell = (value: unknown) => {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of the audit trail, with the same filters as /audit. Scoped by RLS. */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("is_active").eq("id", uid).maybeSingle();
  if (!me?.is_active) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const q = searchTerm(sp.get("q") ?? undefined);
  const entity = param(sp.get("entity") ?? undefined);
  const action = param(sp.get("action") ?? undefined);
  const from = param(sp.get("from") ?? undefined);
  const to = param(sp.get("to") ?? undefined);

  const rows: AuditLog[] = [];
  const pageSize = 1000;
  for (let page = 0; page < MAX_ROWS / pageSize; page++) {
    let query = supabase.from("audit_logs").select("*");
    if (q) query = query.or(`summary.ilike.*${q}*,actor_email.ilike.*${q}*`);
    if (entity in ENTITY_LABELS) query = query.eq("entity_type", entity);
    if (action in ACTION_LABELS) query = query.eq("action", action);
    if (isDate(from)) query = query.gte("occurred_at", `${from}T00:00:00+05:30`);
    if (isDate(to)) query = query.lte("occurred_at", `${to}T23:59:59.999+05:30`);

    const { data, error } = await query
      .order("occurred_at", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;
    rows.push(...(data as AuditLog[]));
    if (data.length < pageSize) break;
  }

  await supabase.rpc("log_event", {
    p_action: "report.export",
    p_summary: `Audit trail (${rows.length}${rows.length === MAX_ROWS ? "+" : ""} rows)${request.nextUrl.search}`,
  });

  const header = [
    "occurred_at",
    "actor_email",
    "actor_role",
    "action",
    "entity_type",
    "summary",
    "institution_id",
    "deposit_id",
  ];
  const csv = [
    header.join(","),
    ...rows.map((r) =>
      [r.occurred_at, r.actor_email, r.actor_role, r.action, r.entity_type, r.summary, r.institution_id, r.deposit_id]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
