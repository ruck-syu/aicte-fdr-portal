import { formatDateTime } from "@/lib/format";

/** Shows only on paper: the document header above the page title. */
export function PrintMeta({ label }: { label?: string }) {
  return (
    <div className="print-only mb-3 border-b border-slate-400 pb-1.5 text-xs text-slate-600">
      AICTE Security Deposit &amp; FDR Portal
      {label ? ` · ${label}` : ""} · Generated {formatDateTime(new Date().toISOString())}
    </div>
  );
}
