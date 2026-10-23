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
