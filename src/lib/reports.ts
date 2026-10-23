import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate } from "./format";
import { INSTRUMENT_SHORT, REGION_LABELS, RELEASE_REASON_LABELS, STATUS_LABELS, VALIDITY_LABELS } from "./labels";
import { param, searchTerm } from "./query";
import type {
  DemandOverview,
  DepositOverview,
  DepositStatus,
  InstrumentType,
  Region,
  ReleaseOverview,
  Validity,
} from "./types";

export type Cell = string | number | null;
export type Column = { key: string; label: string; numeric?: boolean; money?: boolean };
export type ReportResult = {
  title: string;
  description: string;
  columns: Column[];
  rows: (Record<string, Cell> & { _href?: string })[];
  total?: number;
};

export const REPORTS = {
  "expiring-next-quarter": "Expiring next quarter",
  "missing-deposits": "Institutions with missing deposits",
  lapsed: "Matured without renewal",
  flagged: "Flagged / returned deposits",
  "pending-releases": "Releases awaiting decision",
  deposits: "Full deposit register",
} as const;
export type ReportKey = keyof typeof REPORTS;

type Params = Record<string, string | string[] | undefined>;

/** Calendar quarter after the current one, as YYYY-MM-DD bounds (IST). */
export function nextQuarter(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const startMonth = Math.floor(ist.getUTCMonth() / 3) * 3 + 3;
  const start = new Date(Date.UTC(ist.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const q = Math.floor(start.getUTCMonth() / 3) + 1;
  return { from: iso(start), to: iso(end), label: `Q${q} ${start.getUTCFullYear()} (${formatDate(iso(start))} – ${formatDate(iso(end))})` };
}

const depositColumns: Column[] = [
  { key: "reference_no", label: "Reference" },
  { key: "institution", label: "Institution" },
  { key: "aicte_id", label: "AICTE ID" },
  { key: "region", label: "Region" },
  { key: "instrument", label: "Instrument" },
  { key: "bank", label: "Bank" },
  { key: "amount", label: "Amount (₹)", numeric: true, money: true },
  { key: "issue_date", label: "Issue date" },
  { key: "maturity_date", label: "Maturity date" },
  { key: "status", label: "Status" },
];

function depositRow(d: DepositOverview) {
  return {
    _href: `/deposits/${d.id}`,
    reference_no: d.reference_no,
    institution: d.institution_name,
    aicte_id: d.institution_aicte_id,
    region: REGION_LABELS[d.region],
    instrument: `${INSTRUMENT_SHORT[d.instrument_type]} ${d.instrument_number}`,
    bank: d.bank_name,
    amount: Number(d.amount),
    issue_date: d.issue_date,
    maturity_date: d.maturity_date,
    status: STATUS_LABELS[d.status] + (d.validity ? ` · ${VALIDITY_LABELS[d.validity]}` : ""),
  };
}

export async function runReport(supabase: SupabaseClient, key: ReportKey, params: Params = {}): Promise<ReportResult> {
  switch (key) {
    case "expiring-next-quarter": {
      const q = nextQuarter();
      const { data } = await supabase
        .from("deposit_overview")
        .select("*")
        .in("status", ["verified", "release_requested"])
        .gte("maturity_date", q.from)
        .lte("maturity_date", q.to)
        .order("maturity_date");
      return {
        title: REPORTS[key],
        description: `Verified instruments maturing in ${q.label}. Institutions must furnish renewals before these dates.`,
        columns: depositColumns,
        rows: ((data ?? []) as DepositOverview[]).map(depositRow),
      };
    }
    case "lapsed": {
      const { data } = await supabase
        .from("deposit_overview")
        .select("*")
        .eq("validity", "expired")
        .order("maturity_date");
      return {
        title: REPORTS[key],
        description: "Deposits still held whose instrument has matured with no verified renewal: AICTE is currently unsecured.",
        columns: [...depositColumns, { key: "days", label: "Days lapsed", numeric: true }],
        rows: ((data ?? []) as DepositOverview[]).map((d) => ({ ...depositRow(d), days: -d.days_to_maturity })),
      };
    }
    case "missing-deposits": {
      const { data } = await supabase
        .from("demand_overview")
        .select("*")
        .eq("status", "open")
        .eq("deposits_submitted", 0)
        .order("due_date");
      return {
        title: REPORTS[key],
        description:
          "Open deposit demands against which the institution has not furnished any instrument. Overdue rows are past the submission window.",
        columns: [
          { key: "institution", label: "Institution" },
          { key: "aicte_id", label: "AICTE ID" },
          { key: "region", label: "Region" },
          { key: "demand", label: "Demand" },
          { key: "approval_case_id", label: "Approval case" },
          { key: "required", label: "Required (₹)", numeric: true, money: true },
          { key: "due_date", label: "Due date" },
          { key: "overdue", label: "Overdue" },
        ],
        rows: ((data ?? []) as DemandOverview[]).map((m) => ({
          _href: `/demands?q=${encodeURIComponent(m.reference_no)}`,
          institution: m.institution_name,
          aicte_id: m.institution_aicte_id,
          region: REGION_LABELS[m.region],
          demand: m.reference_no,
          approval_case_id: m.approval_case_id,
          required: Number(m.required_amount),
          due_date: m.due_date,
          overdue: m.is_overdue ? "Yes" : "No",
        })),
      };
    }
    case "flagged": {
      const { data } = await supabase
        .from("deposit_overview")
        .select("*")
        .in("status", ["submitted", "discrepancy"])
        .gt("open_flags", 0)
        .order("submitted_at");
      return {
        title: REPORTS[key],
        description: "Deposits with open discrepancy flags (wrong dates, amount shortfalls, duplicates, bank mismatches, officer queries).",
        columns: [...depositColumns, { key: "flags", label: "Open flags", numeric: true }],
        rows: ((data ?? []) as DepositOverview[]).map((d) => ({ ...depositRow(d), flags: d.open_flags })),
      };
    }
    case "pending-releases": {
      const { data } = await supabase
        .from("release_overview")
        .select("*")
        .eq("status", "submitted")
        .order("submitted_at");
      return {
        title: REPORTS[key],
        description: "Release / refund applications submitted and awaiting an officer's decision.",
        columns: [
          { key: "reference_no", label: "Request" },
          { key: "institution", label: "Institution" },
          { key: "deposit", label: "Deposit" },
          { key: "amount", label: "Amount (₹)", numeric: true, money: true },
          { key: "reason", label: "Reason" },
          { key: "submitted", label: "Submitted" },
        ],
        rows: ((data ?? []) as ReleaseOverview[]).map((r) => ({
          _href: `/releases/${r.id}`,
          reference_no: r.reference_no,
          institution: r.institution_name,
          deposit: r.deposit_reference_no,
          amount: Number(r.amount),
          reason: RELEASE_REASON_LABELS[r.reason],
          submitted: r.submitted_at?.slice(0, 10) ?? null,
        })),
      };
    }
    case "deposits": {
      // Same filters as the Deposits list page.
      const q = searchTerm(params.q);
      const status = param(params.status);
      const validity = param(params.validity);
      const region = param(params.region);
      const instrument = param(params.instrument);
      let query = supabase.from("deposit_overview").select("*");
      if (q) {
        query = query.or(
          ["reference_no", "instrument_number", "bank_name", "institution_name", "institution_aicte_id", "approval_case_id"]
            .map((c) => `${c}.ilike.*${q}*`)
            .join(","),
        );
      }
      if (status === "held") query = query.in("status", ["verified", "release_requested"]);
      else if (status in STATUS_LABELS) query = query.eq("status", status as DepositStatus);
      if (validity in VALIDITY_LABELS) query = query.eq("validity", validity as Validity);
      if (region in REGION_LABELS) query = query.eq("region", region as Region);
      if (instrument in INSTRUMENT_SHORT) query = query.eq("instrument_type", instrument as InstrumentType);
      const { data } = await query.order("institution_name").order("maturity_date").limit(10000);
      return {
        title: REPORTS[key],
        description: "Every deposit in your jurisdiction matching the current filters.",
        columns: [
          ...depositColumns,
          { key: "approval_case_id", label: "Approval case" },
          { key: "approval_valid_until", label: "Approval valid until" },
          { key: "flags", label: "Open flags", numeric: true },
        ],
        rows: ((data ?? []) as DepositOverview[]).map((d) => ({
          ...depositRow(d),
          approval_case_id: d.approval_case_id,
          approval_valid_until: d.approval_valid_until,
          flags: d.open_flags,
        })),
      };
    }
  }
}

export function toCsv(report: ReportResult) {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    report.columns.map((c) => esc(c.label)).join(","),
    ...report.rows.map((r) => report.columns.map((c) => esc(r[c.key] ?? null)).join(",")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
