import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate } from "./format";
import {
  DEMAND_STATUS_LABELS,
  INSTRUMENT_SHORT,
  REGION_LABELS,
  RELEASE_REASON_LABELS,
  RELEASE_STATUS_LABELS,
  STATUS_LABELS,
  VALIDITY_LABELS,
} from "./labels";
import { param, searchTerm } from "./query";
import type {
  DashboardStats,
  DemandOverview,
  DemandStatus,
  DepositOverview,
  DepositStatus,
  InstrumentType,
  Region,
  ReleaseOverview,
  ReleaseStatus,
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
  "sanctioned-refunds": "Sanctioned refunds",
  kpis: "KPIs & service levels",
  deposits: "Full deposit register",
  releases: "Full release register",
  demands: "Full demand register",
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
      // Everything undecided, including releases parked for a second signature.
      const { data } = await supabase
        .from("release_overview")
        .select("*")
        .in("status", ["submitted", "pending_second_approval"])
        .order("submitted_at");
      return {
        title: REPORTS[key],
        description:
          "Release / refund applications awaiting a first or second decision, oldest first.",
        columns: [
          { key: "reference_no", label: "Request" },
          { key: "institution", label: "Institution" },
          { key: "deposit", label: "Deposit" },
          { key: "amount", label: "Amount (₹)", numeric: true, money: true },
          { key: "reason", label: "Reason" },
          { key: "stage", label: "Stage" },
          { key: "submitted", label: "Submitted" },
        ],
        rows: ((data ?? []) as ReleaseOverview[]).map((r) => ({
          _href: `/releases/${r.id}`,
          reference_no: r.reference_no,
          institution: r.institution_name,
          deposit: r.deposit_reference_no,
          amount: Number(r.amount),
          reason: RELEASE_REASON_LABELS[r.reason],
          stage: RELEASE_STATUS_LABELS[r.status],
          submitted: r.submitted_at?.slice(0, 10) ?? null,
        })),
      };
    }
    case "sanctioned-refunds": {
      const { data } = await supabase
        .from("release_overview")
        .select("*")
        .eq("status", "approved")
        .order("sanctioned_at", { ascending: false });
      return {
        title: REPORTS[key],
        description:
          "Approved releases with the refund quote frozen at approval: principal, interest accrued to the sanction date and the early-release penalty deducted.",
        columns: [
          { key: "reference_no", label: "Request" },
          { key: "institution", label: "Institution" },
          { key: "deposit", label: "Deposit" },
          { key: "sanctioned", label: "Sanctioned (₹)", numeric: true, money: true },
          { key: "principal", label: "Principal (₹)", numeric: true, money: true },
          { key: "interest", label: "Interest (₹)", numeric: true, money: true },
          { key: "penalty", label: "Penalty (₹)", numeric: true, money: true },
          { key: "sanctioned_at", label: "Sanctioned on" },
        ],
        rows: ((data ?? []) as ReleaseOverview[]).map((r) => ({
          _href: `/releases/${r.id}`,
          reference_no: r.reference_no,
          institution: r.institution_name,
          deposit: r.deposit_reference_no,
          sanctioned: r.sanctioned_amount === null ? null : Number(r.sanctioned_amount),
          principal: r.quote ? Number(r.quote.principal) : Number(r.amount),
          interest: r.quote ? Number(r.quote.accrued_interest) : null,
          penalty: r.quote ? Number(r.quote.penalty_amount) : null,
          sanctioned_at: r.sanctioned_at?.slice(0, 10) ?? null,
        })),
      };
    }
    case "kpis": {
      const { data } = await supabase.rpc("dashboard_stats");
      const s = (data ?? {}) as DashboardStats;
      const hours = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v} h`);
      const days = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v} days`);
      const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);
      return {
        title: REPORTS[key],
        description:
          "Turnaround and compliance measures for your jurisdiction. Verification and flag-ageing figures use the last 90 days; “—” means there is no sample yet.",
        columns: [
          { key: "metric", label: "Measure" },
          { key: "value", label: "Value" },
        ],
        rows: [
          { metric: "Average submission → verification", value: hours(s.avg_verification_hours) },
          { metric: "Submission → verification, 90th percentile", value: hours(s.p90_verification_hours) },
          { metric: "Renewal compliance (renewed ÷ renewed + lapsed)", value: pct(s.renewal_compliance_pct) },
          { metric: "Open discrepancy flag, median age", value: days(s.open_flag_p50_days) },
          { metric: "Open discrepancy flag, 90th percentile age", value: days(s.open_flag_p90_days) },
          { metric: "Deposits held", value: s.held_count ?? 0 },
          { metric: "Matured without renewal", value: s.expired ?? 0 },
          { metric: "Pending verification", value: s.pending_verification ?? 0 },
        ],
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
      // Follow the list page's column sort so the CSV matches what was on screen.
      const sort = param(params.sort);
      const dir = param(params.dir);
      const fields: Record<string, string> = {
        reference: "reference_no",
        institution: "institution_name",
        amount: "amount",
        issue: "issue_date",
        maturity: "maturity_date",
      };
      const ascending = dir === "asc" || dir === "desc" ? dir === "asc" : ["reference", "institution", "issue", "maturity"].includes(sort);
      const { data } = await query.order(fields[sort] ?? "updated_at", { ascending }).limit(10000);
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
    case "releases": {
      // Same filters as the Releases list page, including a clearance officer's cell queue.
      const q = searchTerm(params.q);
      const status = param(params.status);
      const awaiting = param(params.awaiting) === "me";
      const { data: claims } = await supabase.auth.getClaims();
      const { data: me } = await supabase
        .from("profiles")
        .select("role, clearance_cell")
        .eq("id", claims?.claims?.sub ?? "")
        .maybeSingle();
      const cell = me?.role === "release_officer" ? (me.clearance_cell as string | null) : null;
      let mine: string[] = [];
      if (awaiting && cell) {
        const { data: pending } = await supabase
          .from("release_clearances")
          .select("release_request_id")
          .eq("cell", cell)
          .eq("status", "pending");
        mine = [...new Set(((pending ?? []) as { release_request_id: string }[]).map((c) => c.release_request_id))];
      }

      let query = supabase.from("release_overview").select("*");
      if (q) {
        query = query.or(
          ["reference_no", "deposit_reference_no", "instrument_number", "institution_name", "institution_aicte_id"]
            .map((c) => `${c}.ilike.*${q}*`)
            .join(","),
        );
      }
      if (awaiting && cell) {
        query = query.eq("status", "submitted").in("id", mine.length ? mine : ["00000000-0000-0000-0000-000000000000"]);
      } else if (status in RELEASE_STATUS_LABELS) {
        query = query.eq("status", status as ReleaseStatus);
      }

      // Follow the list page's column sort.
      const sort = param(params.sort);
      const dir = param(params.dir);
      const fields: Record<string, string> = { reference: "reference_no", amount: "amount", submitted: "submitted_at" };
      const ascending = dir === "asc" || dir === "desc" ? dir === "asc" : ["reference", "submitted"].includes(sort);
      const { data } = await query.order(fields[sort] ?? "created_at", { ascending }).limit(10000);
      const releases = (data ?? []) as ReleaseOverview[];

      // Clearance progress lives in its own table; fetch it for the exported page.
      const progress = new Map<string, { cleared: number; total: number; blocked: number }>();
      if (releases.length) {
        const { data: clearances } = await supabase
          .from("release_clearances")
          .select("release_request_id, status")
          .in("release_request_id", releases.map((r) => r.id));
        for (const c of (clearances ?? []) as { release_request_id: string; status: string }[]) {
          const p = progress.get(c.release_request_id) ?? { cleared: 0, total: 0, blocked: 0 };
          p.total += 1;
          if (c.status === "cleared") p.cleared += 1;
          else if (c.status === "blocked") p.blocked += 1;
          progress.set(c.release_request_id, p);
        }
      }

      return {
        title: REPORTS[key],
        description: "Release and refund applications matching the current filters, with the clearances recorded on each.",
        columns: [
          { key: "reference_no", label: "Request" },
          { key: "institution", label: "Institution" },
          { key: "aicte_id", label: "AICTE ID" },
          { key: "deposit", label: "Deposit" },
          { key: "amount", label: "Amount (₹)", numeric: true, money: true },
          { key: "reason", label: "Reason" },
          { key: "status", label: "Status" },
          { key: "clearances", label: "Clearances" },
          { key: "submitted", label: "Submitted" },
          { key: "decided", label: "Decided" },
          { key: "noc", label: "NOC reference" },
        ],
        rows: releases.map((r) => {
          const p = progress.get(r.id);
          return {
            _href: `/releases/${r.id}`,
            reference_no: r.reference_no,
            institution: r.institution_name,
            aicte_id: r.institution_aicte_id,
            deposit: r.deposit_reference_no,
            amount: Number(r.amount),
            reason: RELEASE_REASON_LABELS[r.reason],
            status: RELEASE_STATUS_LABELS[r.status],
            clearances: p ? `${p.cleared}/${p.total}${p.blocked ? " · blocked" : ""}` : "",
            submitted: r.submitted_at?.slice(0, 10) ?? null,
            decided: r.decided_at?.slice(0, 10) ?? null,
            noc: r.noc_reference,
          };
        }),
      };
    }
    case "demands": {
      // Same filters as the Demands list page.
      const q = searchTerm(params.q);
      const status = param(params.status);
      let query = supabase.from("demand_overview").select("*");
      if (q) {
        query = query.or(
          ["reference_no", "approval_case_id", "program", "institution_name", "institution_aicte_id"]
            .map((c) => `${c}.ilike.*${q}*`)
            .join(","),
        );
      }
      if (status === "overdue") query = query.eq("is_overdue", true);
      else if (status in DEMAND_STATUS_LABELS) query = query.eq("status", status as DemandStatus);

      const { data } = await query.order("status").order("due_date").limit(10000);
      return {
        title: REPORTS[key],
        description: "Deposit demands matching the current filters, with what has been furnished against each.",
        columns: [
          { key: "reference_no", label: "Demand" },
          { key: "institution", label: "Institution" },
          { key: "aicte_id", label: "AICTE ID" },
          { key: "region", label: "Region" },
          { key: "approval_case_id", label: "Approval case" },
          { key: "program", label: "Programme" },
          { key: "required", label: "Required (₹)", numeric: true, money: true },
          { key: "deposits_submitted", label: "Deposits furnished", numeric: true },
          { key: "intimation_date", label: "Intimated" },
          { key: "due_date", label: "Due date" },
          { key: "status", label: "Status" },
        ],
        rows: ((data ?? []) as DemandOverview[]).map((m) => ({
          _href: `/demands?q=${encodeURIComponent(m.reference_no)}`,
          reference_no: m.reference_no,
          institution: m.institution_name,
          aicte_id: m.institution_aicte_id,
          region: REGION_LABELS[m.region],
          approval_case_id: m.approval_case_id,
          program: m.program,
          required: Number(m.required_amount),
          deposits_submitted: m.deposits_submitted,
          intimation_date: m.intimation_date,
          due_date: m.due_date,
          status: m.is_overdue ? "Overdue" : DEMAND_STATUS_LABELS[m.status],
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
