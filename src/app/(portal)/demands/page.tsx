import type { Metadata } from "next";
import Link from "next/link";
import { requireUser, isOfficial } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { daysOverdue, formatDate, formatINR } from "@/lib/format";
import { DEMAND_STATUS_LABELS } from "@/lib/labels";
import { pageRange, param, searchTerm } from "@/lib/query";
import type { AphRate, DemandOverview, DemandStatus, Institution } from "@/lib/types";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { DemandStatusBadge } from "@/components/badges";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { FilterBar, FilterSelect, Pagination } from "@/components/list-controls";
import { createDemand, setDemandStatus } from "./actions";
import { RateFields } from "./rate-fields";

export const metadata: Metadata = { title: "Deposit demands" };

export default async function DemandsPage({ searchParams }: PageProps<"/demands">) {
  const params = await searchParams;
  const user = await requireUser();
  const official = isOfficial(user.role);
  const supabase = await createClient();

  const q = searchTerm(params.q);
  const status = param(params.status);
  const { page, from, to } = pageRange(params.page);

  let query = supabase.from("demand_overview").select("*", { count: "exact" });
  if (q) {
    query = query.or(
      ["reference_no", "approval_case_id", "program", "institution_name", "institution_aicte_id"]
        .map((c) => `${c}.ilike.*${q}*`)
        .join(","),
    );
  }
  if (status === "overdue") query = query.eq("is_overdue", true);
  else if (status in DEMAND_STATUS_LABELS) query = query.eq("status", status as DemandStatus);

  const today = new Date().toISOString().slice(0, 10);
  const [{ data, count }, institutionsRes, ratesRes] = await Promise.all([
    query.order("status").order("due_date").range(from, to),
    official
      ? supabase.from("institutions").select("id, name, aicte_id").order("name").limit(1000)
      : Promise.resolve({ data: [] }),
    official
      ? supabase
          .from("aph_deposit_rates")
          .select("id, program_key, level, program_label, amount, effective_from, effective_to, source_note")
          .lte("effective_from", today)
          .or(`effective_to.is.null,effective_to.gte.${today}`)
          .order("program_label")
      : Promise.resolve({ data: [] }),
  ]);
  const rows = (data ?? []) as DemandOverview[];
  const institutions = (institutionsRes.data ?? []) as Pick<Institution, "id" | "name" | "aicte_id">[];
  const rates = (ratesRes.data ?? []) as AphRate[];

  return (
    <>
      <PageHeader
        title="Deposit demands"
        description={
          official
            ? "Security deposits AICTE has asked institutions to furnish for an approval. Overdue demands (no deposit within the submission window) are flagged and alerted automatically."
            : "Security deposits AICTE has asked your institution to furnish."
        }
      />

      {official && (
        <details className="group mb-6 rounded-lg border border-slate-200 bg-white shadow-xs">
          <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-brand-800 select-none">
            + Issue a deposit demand
          </summary>
          <ActionForm action={createDemand} resetOnSuccess className="border-t border-slate-100 p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Institution" required htmlFor="institution_id" className="sm:col-span-2 lg:col-span-3">
                <select id="institution_id" name="institution_id" required className="input" defaultValue="">
                  <option value="" disabled>
                    Select institution…
                  </option>
                  {institutions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.aicte_id})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Approval case / LOA reference" required htmlFor="approval_case_id">
                <input id="approval_case_id" name="approval_case_id" required className="input" placeholder="e.g. F.No. Northern/1-123456789/2026/EOA" />
              </Field>
              <RateFields rates={rates} />
              <Field label="Approval valid until" htmlFor="approval_valid_until" hint="Deposit must not mature before this date">
                <input id="approval_valid_until" name="approval_valid_until" type="date" className="input" />
              </Field>
              <Field label="Intimation date" required htmlFor="intimation_date" hint="Due date is set from the submission window">
                <input id="intimation_date" name="intimation_date" type="date" required defaultValue={today} className="input" />
              </Field>
              <Field label="Notes" htmlFor="notes">
                <input id="notes" name="notes" className="input" />
              </Field>
            </div>
            <div className="mt-4">
              <SubmitButton>Issue demand</SubmitButton>
            </div>
          </ActionForm>
        </details>
      )}

      <FilterBar action="/demands" q={q} placeholder="Reference, approval case, programme, institution…" resetHref="/demands">
        <FilterSelect
          name="status"
          label="Status"
          value={status}
          options={[...(Object.entries(DEMAND_STATUS_LABELS) as [string, string][]), ["overdue", "Overdue"]]}
        />
      </FilterBar>

      <Card bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState title="No deposit demands" />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Demand</th>
                  {official && <th>Institution</th>}
                  <th>Approval case</th>
                  <th className="text-right">Required</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="font-medium">{m.reference_no}</td>
                    {official && (
                      <td className="max-w-56">
                        <div className="truncate">{m.institution_name}</div>
                        <div className="text-xs text-slate-500">{m.institution_aicte_id}</div>
                      </td>
                    )}
                    <td>
                      <div>{m.approval_case_id}</div>
                      {m.program && <div className="text-xs text-slate-500">{m.program}</div>}
                    </td>
                    <td className="num text-right">{formatINR(m.required_amount)}</td>
                    <td className="whitespace-nowrap">
                      <div className="num">{formatDate(m.due_date)}</div>
                      {m.is_overdue && m.status === "open" && (
                        <div className="text-xs font-medium text-red-700">{daysOverdue(m.due_date)}d overdue</div>
                      )}
                    </td>
                    <td>
                      <DemandStatusBadge status={m.status} overdue={m.is_overdue} />
                      <div className="mt-0.5 text-xs text-slate-500">
                        {m.deposits_submitted} deposit{m.deposits_submitted === 1 ? "" : "s"} furnished
                      </div>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {!official && m.status === "open" && (
                        <Link href={`/deposits/new?demand=${m.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                          Furnish deposit
                        </Link>
                      )}
                      {official && (
                        <div className="flex justify-end gap-2">
                          <Link
                            href={`/deposits?q=${encodeURIComponent(m.approval_case_id)}`}
                            className="text-xs font-medium text-brand-700 hover:underline"
                          >
                            Deposits
                          </Link>
                          {m.status === "open" ? (
                            <ActionForm action={setDemandStatus} confirm="Waive this demand?" hideOk>
                              <input type="hidden" name="id" value={m.id} />
                              <input type="hidden" name="status" value="waived" />
                              <button className="text-xs font-medium text-slate-600 hover:underline">Waive</button>
                            </ActionForm>
                          ) : m.status === "waived" ? (
                            <ActionForm action={setDemandStatus} hideOk>
                              <input type="hidden" name="id" value={m.id} />
                              <input type="hidden" name="status" value="open" />
                              <button className="text-xs font-medium text-slate-600 hover:underline">Reopen</button>
                            </ActionForm>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath="/demands" params={params} page={page} total={count ?? 0} />
      </Card>
    </>
  );
}
