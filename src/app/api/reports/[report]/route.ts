import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isOfficial } from "@/lib/auth";
import { REPORTS, runReport, toCsv, type ReportKey } from "@/lib/reports";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/reports/[report]">) {
  const { report } = await ctx.params;
  if (!(report in REPORTS)) return NextResponse.json({ error: "Unknown report" }, { status: 404 });

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, is_active").eq("id", uid).maybeSingle();
  if (!me?.is_active || !isOfficial(me.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const result = await runReport(supabase, report as ReportKey, params);
  await supabase.rpc("log_event", {
    p_action: "report.export",
    p_summary: `${result.title} (${result.rows.length} rows)${request.nextUrl.search ? ` ${request.nextUrl.search}` : ""}`,
  });

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(result), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
