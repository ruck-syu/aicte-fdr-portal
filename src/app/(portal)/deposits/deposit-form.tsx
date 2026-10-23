import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, LinkButton } from "@/components/ui";
import { INSTRUMENT_LABELS } from "@/lib/labels";
import { formatDate, formatINR } from "@/lib/format";
import type { ActionState, Demand, Deposit, InstrumentType } from "@/lib/types";

type Defaults = Partial<Deposit>;

export function DepositForm({
  action,
  defaults = {},
  demands,
  replaces,
  submitLabel,
  cancelHref,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaults?: Defaults;
  demands: Demand[];
  replaces?: Pick<Deposit, "id" | "reference_no" | "maturity_date"> | null;
  submitLabel: string;
  cancelHref: string;
}) {
  const v = (k: keyof Deposit) => {
    const val = defaults[k];
    return val === null || val === undefined ? undefined : String(val);
  };
  return (
    <ActionForm action={action} className="space-y-8">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      {replaces && <input type="hidden" name="replaces_deposit_id" value={replaces.id} />}

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Instrument</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Instrument type" required htmlFor="instrument_type">
            <select id="instrument_type" name="instrument_type" className="input" defaultValue={v("instrument_type") ?? "fdr"}>
              {(Object.entries(INSTRUMENT_LABELS) as [InstrumentType, string][]).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Instrument / FDR number" required htmlFor="instrument_number">
            <input
              id="instrument_number"
              name="instrument_number"
              className="input"
              required
              maxLength={60}
              defaultValue={v("instrument_number")}
            />
          </Field>
          <Field label="Amount (₹)" required htmlFor="amount">
            <input
              id="amount"
              name="amount"
              className="input num"
              inputMode="decimal"
              required
              defaultValue={v("amount")}
              placeholder="e.g. 1000000"
            />
          </Field>
          <Field label="Issue date" required htmlFor="issue_date">
            <input id="issue_date" name="issue_date" type="date" className="input" required defaultValue={v("issue_date")} />
          </Field>
          <Field label="Maturity date" required htmlFor="maturity_date" hint="Must cover the approval period">
            <input
              id="maturity_date"
              name="maturity_date"
              type="date"
              className="input"
              required
              defaultValue={v("maturity_date")}
            />
          </Field>
          <Field label="Interest rate (% p.a.)" htmlFor="interest_rate">
            <input
              id="interest_rate"
              name="interest_rate"
              className="input num"
              inputMode="decimal"
              defaultValue={v("interest_rate")}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="auto_renewal"
            className="size-4 rounded border-slate-300"
            defaultChecked={defaults.auto_renewal ?? true}
          />
          Auto-renewal instruction given to the bank
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Issuing bank</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Bank name" required htmlFor="bank_name">
            <input id="bank_name" name="bank_name" className="input" required defaultValue={v("bank_name")} />
          </Field>
          <Field label="Branch" htmlFor="bank_branch">
            <input id="bank_branch" name="bank_branch" className="input" defaultValue={v("bank_branch")} />
          </Field>
          <Field label="IFSC" htmlFor="ifsc" hint="e.g. SBIN0001234">
            <input
              id="ifsc"
              name="ifsc"
              className="input uppercase"
              maxLength={11}
              defaultValue={v("ifsc")}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-slate-900">Approval linkage</legend>
        {replaces && (
          <p className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
            Renewal of <strong>{replaces.reference_no}</strong> (matures {formatDate(replaces.maturity_date)}). Approval
            details carry over; once this renewal is verified the original is marked as replaced.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Against deposit demand"
            htmlFor="demand_id"
            hint="Linking a demand fills the approval case and required amount"
            className="sm:col-span-2 lg:col-span-3"
          >
            <select id="demand_id" name="demand_id" className="input" defaultValue={v("demand_id") ?? ""}>
              <option value="">Not linked to a demand</option>
              {demands.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.reference_no} · {d.approval_case_id} · {formatINR(d.required_amount)}
                  {d.program ? ` · ${d.program}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Approval case / LOA reference" htmlFor="approval_case_id">
            <input id="approval_case_id" name="approval_case_id" className="input" defaultValue={v("approval_case_id")} />
          </Field>
          <Field label="Programme / course" htmlFor="program">
            <input id="program" name="program" className="input" defaultValue={v("program")} />
          </Field>
          <Field label="Approval valid until" htmlFor="approval_valid_until">
            <input
              id="approval_valid_until"
              name="approval_valid_until"
              type="date"
              className="input"
              defaultValue={v("approval_valid_until")}
            />
          </Field>
          <Field label="Required deposit (₹)" htmlFor="required_amount">
            <input
              id="required_amount"
              name="required_amount"
              className="input num"
              inputMode="decimal"
              defaultValue={v("required_amount")}
            />
          </Field>
        </div>
      </fieldset>

      <Field label="Remarks" htmlFor="remarks">
        <textarea id="remarks" name="remarks" rows={3} className="input" maxLength={2000} defaultValue={v("remarks")} />
      </Field>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-5">
        <SubmitButton>{submitLabel}</SubmitButton>
        <LinkButton href={cancelHref} variant="ghost">
          Cancel
        </LinkButton>
        <p className="ml-auto text-xs text-slate-500">
          Saved as a draft. Upload the FDR scan, affidavit and LOA next, then submit.
        </p>
      </div>
    </ActionForm>
  );
}
