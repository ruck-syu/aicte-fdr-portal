import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { DOCUMENT_LABELS } from "@/lib/labels";
import type { AppSettings, DocumentType } from "@/lib/types";
import { Card, Field, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { saveSettings } from "../actions";

export const metadata: Metadata = { title: "Settings" };

function DocChecklist({ name, selected }: { name: string; selected: DocumentType[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(Object.entries(DOCUMENT_LABELS) as [DocumentType, string][]).map(([v, l]) => (
        <label key={v} className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name={name} value={v} defaultChecked={selected.includes(v)} className="size-4 rounded border-slate-300" />
          {l}
        </label>
      ))}
    </div>
  );
}

export default async function SettingsPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("*").maybeSingle();
  const s = data as (AppSettings & { updated_at: string }) | null;
  if (!s) return <PageHeader title="Settings" description="Settings row is missing; re-run the database migration." />;

  return (
    <>
      <PageHeader
        title="Settings"
        description={`Portal-wide rules for alerts and mandatory documents. Last changed ${formatDateTime(s.updated_at)}; every change is recorded in the audit trail.`}
      />
      <ActionForm action={saveSettings} className="max-w-3xl space-y-6">
        <Card title="Maturity alerts & escalation">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Alert thresholds (days before maturity)" htmlFor="alert_days" hint="Comma-separated, e.g. 60, 30, 7" className="sm:col-span-3">
              <input id="alert_days" name="alert_days" defaultValue={s.alert_days.join(", ")} className="input max-w-xs" />
            </Field>
            <Field label="Escalate after lapse (days)" htmlFor="escalation_days" hint="Regional Officer is alerted when a deposit stays lapsed this long">
              <input id="escalation_days" name="escalation_days" type="number" min={0} max={90} defaultValue={s.escalation_days} className="input" />
            </Field>
            <Field label="Submission window (days)" htmlFor="submission_window_days" hint="Time an institution has to furnish a demanded deposit">
              <input
                id="submission_window_days"
                name="submission_window_days"
                type="number"
                min={1}
                max={180}
                defaultValue={s.submission_window_days}
                className="input"
              />
            </Field>
          </div>
        </Card>
        <Card title="Refund & penalty policy" description="Used by the release quote: interest accrued from the issue date, and a penalty when a deposit is released before the minimum holding period.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Minimum holding (years)" htmlFor="min_holding_years" hint="Releasing earlier attracts the penalty below">
              <input
                id="min_holding_years"
                name="min_holding_years"
                type="number"
                min={0}
                max={50}
                step={1}
                defaultValue={s.min_holding_years}
                className="input"
              />
            </Field>
            <Field label="Early-release penalty (%)" htmlFor="early_release_penalty_pct" hint="Percent of the principal deducted">
              <input
                id="early_release_penalty_pct"
                name="early_release_penalty_pct"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={s.early_release_penalty_pct}
                className="input"
              />
            </Field>
            <Field label="Default interest rate (% p.a.)" htmlFor="default_interest_rate" hint="Used when the deposit has no rate of its own">
              <input
                id="default_interest_rate"
                name="default_interest_rate"
                type="number"
                min={0}
                max={50}
                step="0.01"
                defaultValue={s.default_interest_rate}
                className="input"
              />
            </Field>
          </div>
        </Card>
        <Card
          title="Release approvals"
          description="A release whose net payable reaches this amount needs a second signature — from an AICTE verifier or an administrator, and never from the officer who approved first."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Second-approval threshold (₹)"
              htmlFor="release_second_approval_threshold"
              hint="Set 0 to require two signatures on every release"
            >
              <input
                id="release_second_approval_threshold"
                name="release_second_approval_threshold"
                type="number"
                min={0}
                step="0.01"
                defaultValue={s.release_second_approval_threshold}
                className="input"
              />
            </Field>
          </div>
        </Card>
        <Card
          title="Retention & archival"
          description="Settled deposits become archival due this many years after maturity. Archiving never deletes a record: it freezes it, and an administrator can restore it."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Retention window (years)" htmlFor="retention_years" hint="Measured from the maturity date">
              <input
                id="retention_years"
                name="retention_years"
                type="number"
                min={1}
                max={50}
                step={1}
                defaultValue={s.retention_years}
                className="input"
              />
            </Field>
          </div>
        </Card>
        <Card title="Mandatory documents for a deposit" description="A deposit cannot be submitted for verification without these.">
          <DocChecklist name="required_documents" selected={s.required_documents} />
        </Card>
        <Card title="Mandatory documents for a release request" description="A release / refund cannot be submitted without these.">
          <DocChecklist name="release_required_documents" selected={s.release_required_documents} />
        </Card>
        <SubmitButton>Save settings</SubmitButton>
      </ActionForm>
    </>
  );
}
