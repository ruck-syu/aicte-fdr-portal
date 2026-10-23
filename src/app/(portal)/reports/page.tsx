import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatINR } from "@/lib/format";
import { param } from "@/lib/query";
import { REPORTS, runReport, type ReportKey } from "@/lib/reports";
import { Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { PrintMeta } from "@/components/print-meta";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const params = await searchParams;
  await requireRole("regional_officer", "aicte_verifier", "admin");
  const requested = param(params.report);
  const key: ReportKey = requested in REPORTS ? (requested as ReportKey) : "expiring-next-quarter";
  const supabase = await createClient();
  const report = await runReport(supabase, key);
  const totalMoney = report.columns.find((c) => c.money);
  const sum = totalMoney ? report.rows.reduce((a, r) => a + Number(r[totalMoney.key] ?? 0), 0) : null;

  return (
    <>
      <PrintMeta label={report.title} />
      <PageHeader
        title="Reports"
        description="Compliance views across your jurisdiction. Every export is recorded in the audit trail."
      />
      <div className="no-print mb-5 flex flex-wrap gap-1.5">
        {(Object.entries(REPORTS) as [ReportKey, string][])
          .filter(([k]) => k !== "deposits")
          .map(([k, label]) => (
            <Link
              key={k}
              href={`/reports?report=${k}`}
              className={cx(
                "rounded-full px-3 py-1.5 text-sm",
                k === key ? "bg-brand-700 font-medium text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50",
              )}
            >
              {label}
            </Link>
          ))}
      </div>

      <Card
        title={report.title}
        description={report.description}
        actions={
          <span className="no-print flex items-center gap-2">
            <a
              href={`/api/reports/${key}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50"
            >
              <Download className="size-3.5" /> CSV
            </a>
            <PrintButton summary={`${report.title} report (${report.rows.length} rows)`} />
          </span>
        }
        bodyClassName="p-0"
      >
        {report.rows.length === 0 ? (
          <EmptyState title="Nothing to report" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  {report.columns.map((c) => (
                    <th key={c.key} className={c.numeric ? "text-right" : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={i}>
                    {report.columns.map((c, j) => {
                      const v = r[c.key];
                      const text =
                        c.money ? formatINR(v) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : (v ?? "—");
                      return (
                        <td key={c.key} className={cx(c.numeric && "num text-right", "whitespace-nowrap")}>
                          {j === 0 && r._href ? (
                            <Link href={r._href} className="font-medium text-brand-700 hover:underline">
                              {text}
                            </Link>
                          ) : (
                            text
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {sum !== null && (
                <tfoot>
                  <tr className="bg-slate-50 font-medium">
                    <td className="px-4 py-2.5" colSpan={report.columns.findIndex((c) => c.money)}>
                      {report.rows.length} row{report.rows.length === 1 ? "" : "s"}
                    </td>
                    <td className="num px-4 py-2.5 text-right">{formatINR(sum)}</td>
                    <td colSpan={report.columns.length - report.columns.findIndex((c) => c.money) - 1} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
