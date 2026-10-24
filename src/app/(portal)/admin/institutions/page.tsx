import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REGION_LABELS } from "@/lib/labels";
import { pageRange, param, searchTerm } from "@/lib/query";
import type { Institution, Region } from "@/lib/types";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { FilterBar, FilterSelect, Pagination } from "@/components/list-controls";
import { importInstitutions, saveInstitution } from "../actions";

export const metadata: Metadata = { title: "Institutions" };

function InstitutionFields({ i, prefix }: { i?: Institution; prefix: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {i && <input type="hidden" name="id" value={i.id} />}
      <Field label="AICTE ID" required htmlFor={`${prefix}-aicte`}>
        <input id={`${prefix}-aicte`} name="aicte_id" required defaultValue={i?.aicte_id} className="input" placeholder="1-1234567890" />
      </Field>
      <Field label="Name" required htmlFor={`${prefix}-name`} className="sm:col-span-2 lg:col-span-3">
        <input id={`${prefix}-name`} name="name" required defaultValue={i?.name} className="input" />
      </Field>
      <Field label="Region" required htmlFor={`${prefix}-region`}>
        <select id={`${prefix}-region`} name="region" required defaultValue={i?.region ?? ""} className="input">
          <option value="" disabled>
            Select region…
          </option>
          {Object.entries(REGION_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="State" required htmlFor={`${prefix}-state`}>
        <input id={`${prefix}-state`} name="state" required defaultValue={i?.state} className="input" />
      </Field>
      <Field label="City" htmlFor={`${prefix}-city`}>
        <input id={`${prefix}-city`} name="city" defaultValue={i?.city ?? ""} className="input" />
      </Field>
      <Field label="Contact email" htmlFor={`${prefix}-email`} hint="Also receives maturity alerts">
        <input id={`${prefix}-email`} name="contact_email" type="email" defaultValue={i?.contact_email ?? ""} className="input" />
      </Field>
      <Field label="Address" htmlFor={`${prefix}-address`} className="sm:col-span-2 lg:col-span-3">
        <input id={`${prefix}-address`} name="address" defaultValue={i?.address ?? ""} className="input" />
      </Field>
      <Field label="Contact phone" htmlFor={`${prefix}-phone`} hint="Needed before SMS alerts can be sent">
        <input id={`${prefix}-phone`} name="contact_phone" defaultValue={i?.contact_phone ?? ""} className="input" />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="sms_opt_in"
          defaultChecked={i?.sms_opt_in ?? false}
          className="size-4 rounded border-slate-300"
        />
        Send warning / critical alerts by SMS
      </label>
    </div>
  );
}

export default async function InstitutionsPage({ searchParams }: PageProps<"/admin/institutions">) {
  const params = await searchParams;
  await requireRole("admin");
  const supabase = await createClient();

  const q = searchTerm(params.q);
  const region = param(params.region);
  const { page, from, to } = pageRange(params.page);

  let query = supabase.from("institutions").select("*", { count: "exact" });
  if (q) query = query.or(`name.ilike.*${q}*,aicte_id.ilike.*${q}*,city.ilike.*${q}*,state.ilike.*${q}*`);
  if (region in REGION_LABELS) query = query.eq("region", region as Region);
  const { data, count } = await query.order("name").range(from, to);
  const rows = (data ?? []) as Institution[];

  return (
    <>
      <PageHeader
        title="Institutions"
        description="The institution master. Deposits, demands and institute users are linked to these records; Regional Officer access follows the region set here."
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <details className="rounded-lg border border-slate-200 bg-white shadow-xs lg:col-span-2">
          <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-brand-800 select-none">+ Add institution</summary>
          <ActionForm action={saveInstitution} resetOnSuccess className="border-t border-slate-100 p-5">
            <InstitutionFields prefix="new" />
            <div className="mt-4">
              <SubmitButton>Add institution</SubmitButton>
            </div>
          </ActionForm>
        </details>
        <details className="rounded-lg border border-slate-200 bg-white shadow-xs lg:col-span-2">
          <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-brand-800 select-none">Import from CSV</summary>
          <ActionForm action={importInstitutions} resetOnSuccess className="border-t border-slate-100 p-5">
            <p className="mb-3 text-sm text-slate-600">
              Columns: <code className="text-xs">aicte_id, name, state, region</code> (required) and optionally{" "}
              <code className="text-xs">city, address, contact_email, contact_phone</code>. Region may be a key such as{" "}
              <code className="text-xs">north_western</code> or a name such as <code className="text-xs">North-Western</code>. Rows with
              an existing AICTE ID are updated.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
              <SubmitButton variant="secondary">Import</SubmitButton>
            </div>
          </ActionForm>
        </details>
      </div>

      <FilterBar action="/admin/institutions" q={q} placeholder="Search name, AICTE ID, city or state…" resetHref="/admin/institutions">
        <FilterSelect name="region" label="Region" value={region} options={Object.entries(REGION_LABELS)} />
      </FilterBar>

      <Card bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState title="No institutions found">Add one above or import a CSV.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((i) => (
              <li key={i.id}>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-64 flex-1">
                      <div className="text-sm font-medium text-slate-900">{i.name}</div>
                      <div className="text-xs text-slate-500">
                        {i.aicte_id} · {[i.city, i.state].filter(Boolean).join(", ")}
                      </div>
                    </div>
                    <span className="text-sm text-slate-600">{REGION_LABELS[i.region]}</span>
                    <Link href={`/institutions/${i.id}`} className="text-xs text-brand-700 hover:underline">
                      Open register
                    </Link>
                    <Link
                      href={`/deposits?q=${encodeURIComponent(i.aicte_id)}`}
                      className="text-xs text-brand-700 hover:underline"
                    >
                      Deposits
                    </Link>
                  </summary>
                  <ActionForm action={saveInstitution} className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
                    <InstitutionFields i={i} prefix={i.id} />
                    <div className="mt-4">
                      <SubmitButton size="sm">Save changes</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        )}
        <Pagination basePath="/admin/institutions" params={params} page={page} total={count ?? 0} />
      </Card>
    </>
  );
}
